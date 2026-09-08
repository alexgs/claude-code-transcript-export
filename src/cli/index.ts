#!/usr/bin/env node
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CONFIG_NAMES,
  DEFAULT_CONFIG,
  UsageError,
  loadConfig,
  type Config,
} from '../config.js';
import { discover, listLogFiles } from '../discover.js';
import { extract, readSessions, type ExtractSummary } from '../extract.js';
import { defaultLogRoot } from '../paths.js';
import { TEMPLATE } from './init.js';
import { formatProbe, probeRecords } from './probe.js';
import { parseArgs, type Options } from './args.js';

/**
 * The package's own version, read rather than duplicated.
 *
 * It was a string literal, and it drifted the moment the version was bumped:
 * `cctx --version` reported 0.1.0 from the 0.1.2 package. A version command
 * that lies is worse than none, because it sends you chasing the wrong build.
 *
 * `createRequire` rather than an `import` of the JSON: a static import would
 * need an import attribute, and it would drag package.json inside `rootDir`,
 * which it sits outside of. The relative path resolves the same either way —
 * `src/cli/` and `dist/cli/` are both two levels below package.json.
 */
export const VERSION: string = (
  createRequire(import.meta.url)('../../package.json') as { version: string }
).version;

const USAGE = `cctx — extract Claude Code session logs into markdown transcripts.

Usage:
  cctx [extract]   Write transcripts for this project   (default)
  cctx list        Show every session and its status
  cctx probe       Report the observed log schema
  cctx init        Write a .claude-export.yaml here

Options:
  --config <path>    Use this config file
  --project <path>   Treat this directory as the project root
  --out <path>       Override the output directory
  --log-root <path>  Where Claude Code keeps logs (default ~/.claude/projects)
  --keep-tools       Keep tool_use and tool_result payloads
  --keep-thinking    Keep thinking blocks
  --commits          Pair sessions with commits made while they were open
  --ignore-config    Ignore include/exclude, capturing everything
  --dry-run          Report what would happen, write nothing
  --json             Emit the summary as JSON
  -h, --help         This message
  -v, --version      Print the version`;

/** Applies command-line overrides on top of a loaded config. */
function applyOverrides(config: Config, options: Options): Config {
  const merged: Config = { ...config, index: { ...config.index } };
  if (options.out !== undefined) merged.out = options.out;
  if (options.keepTools) merged.tools = 'keep';
  if (options.keepThinking) merged.thinking = 'keep';
  if (options.commits !== undefined) merged.commits = options.commits;
  if (options.ignoreConfig) {
    merged.include = [];
    merged.exclude = [];
  }
  return merged;
}

interface Resolved {
  root: string;
  configPath: string | null;
  config: Config;
  logRoot: string;
}

function resolveContext(options: Options, cwd: string): Resolved {
  const logRoot = resolve(options.logRoot ?? defaultLogRoot(homedir()));

  if (options.config !== undefined) {
    const path = resolve(options.config);
    if (!existsSync(path)) throw new UsageError(`no such config file: ${path}`);
    const loaded = loadConfig(path.replace(/\/[^/]+$/, ''));
    if (loaded === null) throw new UsageError(`could not read config at ${path}`);
    return { ...loaded, config: applyOverrides(loaded.config, options), logRoot };
  }

  const loaded = loadConfig(cwd, options.project);
  if (loaded === null) {
    throw new UsageError(
      `no ${CONFIG_NAMES[0]} found in ${cwd} or any parent directory. ` +
        'Run `cctx init` to create one, or pass --project <path>.',
    );
  }

  return { ...loaded, config: applyOverrides(loaded.config, options), logRoot };
}

function todayLocal(now = new Date()): string {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, '0');
  const day = `${now.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function reportExtract(summary: ExtractSummary, out: NodeJS.WritableStream): void {
  const rel = relative(summary.root, summary.outDir) || '.';
  out.write(`project root: ${summary.root}\n`);
  out.write(`output: ${rel}\n`);
  out.write(
    `sessions: ${summary.sessions}, written: ${summary.written}, ` +
      `unchanged: ${summary.unchanged}, turns: ${summary.turns}\n`,
  );

  if (summary.carried.length > 0) {
    // Named as a distinct thing rather than folded into `sessions:`, because
    // it is the answer to "why does the index list more than `cctx list` finds"
    // — most often, a project that moved to a machine the old logs never
    // reached.
    out.write(
      `carried forward: ${summary.carried.length} transcript(s) kept in the ` +
        'index with no log on this machine\n',
    );
  }

  for (const image of summary.imagesWritten) out.write(`image written: ${image}\n`);
  for (const skip of summary.skipped) {
    out.write(`skipped (${skip.reason}): ${skip.title} [${skip.id.slice(0, 8)}]\n`);
  }
  // Reported rather than silent: a deletion in a generated directory should be
  // something the author sees in the output as well as the diff.
  for (const removed of summary.removed) {
    out.write(`removed (${removed.reason}): ${removed.name}\n`);
  }
  if (summary.orphanImages.length > 0) {
    out.write(
      `\n${summary.orphanImages.length} image(s) no transcript references. ` +
        'Not deleted — an image cannot be regenerated once its log is pruned:\n',
    );
    for (const name of summary.orphanImages) out.write(`  ${name}\n`);
  }
}

export function main(
  argv: string[],
  io: {
    stdout: NodeJS.WritableStream;
    stderr: NodeJS.WritableStream;
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
): number {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr.write(`cctx: ${cause.message}\n`);
      return 2;
    }
    throw cause;
  }

  try {
    if (options.command === 'help') {
      io.stdout.write(`${USAGE}\n`);
      return 0;
    }

    if (options.command === 'version') {
      io.stdout.write(`${VERSION}\n`);
      return 0;
    }

    if (options.command === 'init') {
      const path = join(io.cwd, CONFIG_NAMES[0]);
      if (existsSync(path)) {
        io.stderr.write(`cctx: ${path} already exists.\n`);
        return 1;
      }
      writeFileSync(path, TEMPLATE);
      io.stdout.write(`wrote ${path}\nproject root: ${io.cwd}\n`);
      return 0;
    }

    const context = resolveContext(options, io.cwd);
    // The only clock and environment reads in the package live here.
    const today = todayLocal();
    const currentSessionId = io.env.CLAUDE_CODE_SESSION_ID;

    if (options.command === 'probe') {
      const paths = listLogFiles(context.logRoot);
      const report = probeRecords(
        discover(context.logRoot, context.root).map((log) => ({
          path: log.path,
          records: log.records,
        })),
      );
      io.stdout.write(`project root: ${context.root}\n`);
      io.stdout.write(
        `log root: ${context.logRoot} (${paths.length} logs, all projects)\n\n`,
      );
      io.stdout.write(
        options.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : `${formatProbe(report)}\n`,
      );
      return 0;
    }

    if (options.command === 'list') {
      const sessions = readSessions(
        discover(context.logRoot, context.root),
        context.config,
      );
      if (options.json) {
        io.stdout.write(
          `${JSON.stringify(
            sessions.map((s) => ({
              id: s.id,
              created: s.created,
              title: s.title,
              turns: s.turns.length,
              kind: s.kind,
              excluded: context.config.exclude.includes(s.id),
            })),
            null,
            2,
          )}\n`,
        );
        return 0;
      }

      io.stdout.write(`project root: ${context.root}\n\n`);
      if (sessions.length === 0) {
        io.stdout.write('no sessions found for this project\n');
        return 0;
      }
      for (const session of sessions) {
        const status = context.config.exclude.includes(session.id)
          ? 'excluded'
          : session.turns.length === 0
            ? 'empty'
            : 'included';
        io.stdout.write(
          `${session.id}  ${session.created}  ${String(session.turns.length).padStart(4)} turns  ` +
            `${status.padEnd(8)}  ${session.title}\n`,
        );
      }
      return 0;
    }

    const summary = extract({
      root: context.root,
      logRoot: context.logRoot,
      config: context.config,
      today,
      currentSessionId,
      dryRun: options.dryRun,
    });

    if (options.json) {
      io.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      if (options.dryRun) io.stdout.write('dry run: nothing written\n');
      reportExtract(summary, io.stdout);
    }
    return 0;
  } catch (cause) {
    if (cause instanceof UsageError) {
      io.stderr.write(`cctx: ${cause.message}\n`);
      return 2;
    }
    io.stderr.write(
      `cctx: ${cause instanceof Error ? (cause.stack ?? cause.message) : String(cause)}\n`,
    );
    return 1;
  }
}

/**
 * Run only when this file is the entry point.
 *
 * Two things this has to get right, both of which were wrong first:
 *
 * - Testing that `process.argv[1]` is merely defined is not a main-module
 *   check. It is true on any import, so importing `main` in a test executed
 *   the whole CLI as a side effect.
 *
 * - `process.argv[1]` is the path node was invoked with, which for an
 *   installed package is the `node_modules/.bin/cctx` **symlink**, while
 *   `import.meta.url` is the real file it points at. Comparing them without
 *   resolving the link means the installed binary silently does nothing.
 */
/* c8 ignore start */
const entry = process.argv[1];
const entryUrl =
  entry === undefined ? undefined : pathToFileURL(realpathSync(entry)).href;
if (entryUrl !== undefined && import.meta.url === entryUrl) {
  const code = main(process.argv.slice(2), {
    stdout: process.stdout,
    stderr: process.stderr,
    cwd: process.cwd(),
    env: process.env,
  });
  process.exitCode = code;
}
/* c8 ignore stop */

export { DEFAULT_CONFIG };

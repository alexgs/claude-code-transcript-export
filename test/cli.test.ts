import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { main } from '../src/cli/index.js';
import { parseArgs } from '../src/cli/args.js';
import { formatProbe, probeRecords } from '../src/cli/probe.js';
import { UsageError } from '../src/config.js';
import { assistantRecord, tempDir, userRecord, writeLog } from './helpers.js';

const SESSION_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

/** Captures stdout and stderr instead of writing to the terminal. */
function capture() {
  let out = '';
  let err = '';
  const sink = (append: (s: string) => void) =>
    new Writable({
      write(chunk, _encoding, done) {
        append(String(chunk));
        done();
      },
    });
  return {
    stdout: sink((s) => (out += s)),
    stderr: sink((s) => (err += s)),
    get out() {
      return out;
    },
    get err() {
      return err;
    },
  };
}

function project(withConfig = true) {
  const logRoot = tempDir('cctx-logs-');
  const root = tempDir('cctx-proj-');
  if (withConfig) {
    writeFileSync(join(root, '.claude-export.yaml'), 'out: transcripts\n');
  }
  writeLog(join(logRoot, 'encoded', `${SESSION_ID}.jsonl`), [
    { type: 'mode', sessionId: SESSION_ID },
    { type: 'ai-title', aiTitle: 'A captured session' },
    userRecord('ask', {
      sessionId: SESSION_ID,
      cwd: root,
      timestamp: '2026-08-24T21:13:00Z',
    }),
    assistantRecord('answer', {
      sessionId: SESSION_ID,
      cwd: root,
      timestamp: '2026-08-24T21:14:00Z',
    }),
  ]);
  return { logRoot, root };
}

const run = (argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}) => {
  const io = capture();
  const code = main(argv, { stdout: io.stdout, stderr: io.stderr, cwd, env });
  return { code, out: io.out, err: io.err };
};

describe('parseArgs', () => {
  it('defaults to extract', () => {
    expect(parseArgs([]).command).toBe('extract');
  });

  it('accepts a command', () => {
    expect(parseArgs(['list']).command).toBe('list');
  });

  it('names an unknown command', () => {
    expect(() => parseArgs(['exract'])).toThrow(/unknown command `exract`/);
  });

  it('names an unrecognized flag rather than ignoring it', () => {
    expect(() => parseArgs(['--projekt', 'x'])).toThrow(/unrecognized argument/);
  });

  it('requires a value for a path flag', () => {
    expect(() => parseArgs(['--project', '--json'])).toThrow(UsageError);
  });

  it('reads flags after a command', () => {
    const options = parseArgs(['extract', '--dry-run', '--json']);
    expect(options.dryRun).toBe(true);
    expect(options.json).toBe(true);
  });

  it('lets --no-commits override --commits', () => {
    expect(parseArgs(['--commits', '--no-commits']).commits).toBe(false);
  });
});

describe('cctx extract', () => {
  it('writes transcripts and reports the resolved root', () => {
    const { logRoot, root } = project();
    const result = run(['--log-root', logRoot], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain(`project root: ${root}`);
    expect(result.out).toContain('sessions: 1');
    expect(existsSync(join(root, 'transcripts', 'index.md'))).toBe(true);
  });

  it('writes nothing under --dry-run', () => {
    const { logRoot, root } = project();
    const result = run(['--log-root', logRoot, '--dry-run'], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain('dry run');
    expect(existsSync(join(root, 'transcripts'))).toBe(false);
  });

  it('emits a JSON summary', () => {
    const { logRoot, root } = project();
    const result = run(['--log-root', logRoot, '--json'], root);
    expect(JSON.parse(result.out).sessions).toBe(1);
  });

  it('skips the session it is running inside', () => {
    const { logRoot, root } = project();
    const result = run(['--log-root', logRoot], root, {
      CLAUDE_CODE_SESSION_ID: SESSION_ID,
    });
    expect(result.out).toContain('skipped (active)');
  });

  it('fails with exit 2 and a pointer to init when there is no config', () => {
    const { logRoot, root } = project(false);
    const result = run(['--log-root', logRoot], root);
    expect(result.code).toBe(2);
    expect(result.err).toContain('cctx init');
  });

  it('works without a config when given --project', () => {
    const { logRoot, root } = project(false);
    const result = run(['--log-root', logRoot, '--project', root, '--dry-run'], '/tmp');
    expect(result.code).toBe(0);
    expect(result.out).toContain('sessions: 1');
  });

  it('exits 2 on an unknown flag', () => {
    const result = run(['--nope'], '/tmp');
    expect(result.code).toBe(2);
    expect(result.err).toContain('unrecognized argument');
  });

  it('exits 2 when the log root does not exist', () => {
    const { root } = project();
    const result = run(['--log-root', '/no/such/dir'], root);
    expect(result.code).toBe(2);
    expect(result.err).toContain('no such directory');
  });
});

describe('cctx list', () => {
  it('shows the uuid, so a blocklist can be populated', () => {
    const { logRoot, root } = project();
    const result = run(['list', '--log-root', logRoot], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain(SESSION_ID);
    expect(result.out).toContain('included');
    expect(result.out).toContain('A captured session');
  });

  it('marks an excluded session', () => {
    const { logRoot, root } = project();
    writeFileSync(
      join(root, '.claude-export.yaml'),
      `out: transcripts\nexclude:\n  - ${SESSION_ID}\n`,
    );
    expect(run(['list', '--log-root', logRoot], root).out).toContain('excluded');
  });

  it('says so plainly when a project has no sessions', () => {
    const logRoot = tempDir('cctx-logs-');
    const root = tempDir('cctx-proj-');
    writeFileSync(join(root, '.claude-export.yaml'), 'out: t\n');
    writeLog(join(logRoot, 'other', 'x.jsonl'), [
      userRecord('x', { cwd: '/elsewhere' }),
    ]);
    expect(run(['list', '--log-root', logRoot], root).out).toContain(
      'no sessions found',
    );
  });
});

describe('cctx probe', () => {
  it('reports record and block types', () => {
    const { logRoot, root } = project();
    const result = run(['probe', '--log-root', logRoot], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain('record types:');
    expect(result.out).toContain('user: 1');
  });
});

describe('cctx init', () => {
  it('writes a config and names the root', () => {
    const root = tempDir('cctx-proj-');
    const result = run(['init'], root);
    expect(result.code).toBe(0);
    expect(existsSync(join(root, '.claude-export.yaml'))).toBe(true);
    expect(result.out).toContain(`project root: ${root}`);
  });

  it('refuses to overwrite an existing config', () => {
    const root = tempDir('cctx-proj-');
    writeFileSync(join(root, '.claude-export.yaml'), 'out: x\n');
    const result = run(['init'], root);
    expect(result.code).toBe(1);
    expect(result.err).toContain('already exists');
  });

  it('writes a config that parses back to the defaults', () => {
    const root = tempDir('cctx-proj-');
    run(['init'], root);
    const written = readFileSync(join(root, '.claude-export.yaml'), 'utf8');
    expect(written).toContain('skipActive: false');
    expect(run(['list', '--log-root', tempDir()], root).code).toBe(0);
  });
});

describe('help and version', () => {
  it('prints usage for --help', () => {
    const result = run(['--help'], '/tmp');
    expect(result.code).toBe(0);
    expect(result.out).toContain('cctx list');
  });

  it('prints a version', () => {
    expect(run(['--version'], '/tmp').out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe('probeRecords', () => {
  it('flags a record type this version does not handle', () => {
    const report = probeRecords([
      { path: 'x', records: [{ type: 'brand-new-record' }, { type: 'user' }] },
    ]);
    expect(report.unhandledRecords).toContain('brand-new-record');
    expect(formatProbe(report)).toContain('does not handle');
  });

  it('reports zero files without dividing by zero', () => {
    expect(formatProbe(probeRecords([]))).toBe('session logs: 0');
  });
});

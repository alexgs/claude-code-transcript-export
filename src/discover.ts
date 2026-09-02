import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { UsageError } from './config.js';
import { encodeProjectDir, isWithin } from './paths.js';
import type { RawRecord } from './types.js';

/** How many records to read before giving up on finding identity fields. */
const IDENTITY_SCAN_LIMIT = 50;

export interface LogIdentity {
  path: string;
  sessionId: string | null;
  /** Working directories seen: `cwd` plus any `relocatedCwd`. */
  cwds: string[];
  /** True if any record in the identity scan was flagged as a sidechain. */
  sidechain: boolean;
}

/** Parses a JSONL file, skipping unparseable lines. */
export function parseRecords(contents: string): RawRecord[] {
  const records: RawRecord[] = [];
  for (const line of contents.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as RawRecord);
    } catch {
      // A truncated final line is normal for a session still being written.
      // Skipping it silently is correct; failing the run over it is not.
    }
  }
  return records;
}

export function readLogFile(path: string): RawRecord[] {
  return parseRecords(readFileSync(path, 'utf8'));
}

/**
 * Every session log under `logRoot`, at **depth one exactly**.
 *
 * `<logRoot>/<project>/<session>.jsonl` and nothing deeper. This is not an
 * optimization; it is a correctness requirement. Subagent transcripts live at
 * `<logRoot>/<project>/<parent-session-id>/subagents/agent-<id>.jsonl`, and
 * every record in one carries the *parent's* `sessionId` along with a `cwd`
 * that matches the project. A recursive walk would accept them as project
 * sessions and file them under a UUID that already belongs to a real
 * transcript — producing not an error but a second, wrong document competing
 * with a correct one. See specification §4.4.
 */
export function listLogFiles(logRoot: string): string[] {
  if (!existsSync(logRoot)) {
    throw new UsageError(
      `no such directory: ${logRoot}. Claude Code keeps session logs in ` +
        '~/.claude/projects; pass --log-root if yours are elsewhere.',
    );
  }
  if (!statSync(logRoot).isDirectory()) {
    throw new UsageError(`${logRoot} is not a directory.`);
  }

  const files: string[] = [];
  for (const project of readdirSync(logRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const dir = join(logRoot, project.name);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Depth one: a directory here is a session's subagent store, never a
      // session itself. Not descended into, deliberately.
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      files.push(join(dir, entry.name));
    }
  }

  return files.sort();
}

/**
 * Session id and working directories, read from the head of a log.
 *
 * Capped rather than parsing the whole file: the first record is usually a
 * `mode` record carrying nothing, and across the observed corpus every log
 * reveals its `cwd` within twelve records. Sessions that fail the project match
 * are never fully parsed.
 */
export function readIdentity(path: string, records: RawRecord[]): LogIdentity {
  const identity: LogIdentity = { path, sessionId: null, cwds: [], sidechain: false };

  for (const record of records.slice(0, IDENTITY_SCAN_LIMIT)) {
    if (identity.sessionId === null && typeof record.sessionId === 'string') {
      identity.sessionId = record.sessionId;
    }
    if (record.isSidechain === true) identity.sidechain = true;
    for (const dir of [record.cwd, record.relocatedCwd]) {
      if (typeof dir === 'string' && dir !== '' && !identity.cwds.includes(dir)) {
        identity.cwds.push(dir);
      }
    }
  }

  return identity;
}

/**
 * True when a log belongs to the project rooted at `root`.
 *
 * Two signals, either of which is sufficient.
 *
 * **The containing directory.** Claude Code groups a project's logs in
 * `<logRoot>/<encoded path>`, and it *moves them* when the project is renamed.
 * That makes the directory the more current claim about which project a log
 * belongs to. Note this compares an encoding of the known root against the
 * directory name — it never decodes a name, which is not recoverable.
 *
 * **A recorded `cwd`.** Needed because a session launched from a subdirectory
 * lands in a differently-named directory, and because `relocated` records point
 * at worktrees beneath the project.
 *
 * Neither alone is enough, and the reason is a rename. When a project is
 * renamed the directory follows, but the `cwd` inside already-written records
 * does not: the older logs still name the old path forever. Matching on `cwd`
 * alone silently drops every session from before the rename — 23 of 29 in the
 * corpus this was found in — and the damage is not that they vanish (they do
 * not; nothing is ever synced away) but that they fall out of the generated
 * index while remaining on disk, which is precisely the shape of evidence
 * nobody can audit.
 *
 * The one cost: the encoding is not injective, so `/Users/a/b-c` and
 * `/Users/a/b/c` share a directory name. Two projects related that way would
 * see each other's logs. That is rare, and it is the lesser failure.
 */
export function belongsToProject(
  identity: LogIdentity,
  root: string,
  projectDirName?: string,
): boolean {
  if (identity.sidechain) return false;
  if (projectDirName !== undefined && projectDirName === encodeProjectDir(root)) {
    return true;
  }
  return identity.cwds.some((dir) => isWithin(root, dir));
}

export interface DiscoveredLog extends LogIdentity {
  records: RawRecord[];
}

/**
 * Logs belonging to `root`, fully parsed.
 *
 * Two passes by design: a cheap identity scan decides membership, and only
 * members are parsed in full. Titles arrive late in a file, so there is no
 * shortcut for members — but there is no reason to pay it for other projects.
 */
export function discover(logRoot: string, root: string): DiscoveredLog[] {
  const found: DiscoveredLog[] = [];

  for (const path of listLogFiles(logRoot)) {
    const records = readLogFile(path);
    const identity = readIdentity(path, records);
    if (!belongsToProject(identity, root, basename(dirname(path)))) continue;
    found.push({ ...identity, records });
  }

  return found;
}

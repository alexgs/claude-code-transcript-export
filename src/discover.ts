import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError } from './config.js';
import { isWithin } from './paths.js';
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
 * Membership is decided by `cwd`, never by decoding the project directory name:
 * that encoding is lossy and cannot be reversed. Descendant matching rather
 * than equality covers Claude Code launched from a subdirectory, and worktrees
 * that `relocated` records point at beneath `.claude/worktrees/`.
 */
export function belongsToProject(identity: LogIdentity, root: string): boolean {
  if (identity.sidechain) return false;
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
    if (!belongsToProject(identity, root)) continue;
    found.push({ ...identity, records });
  }

  return found;
}

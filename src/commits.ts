import { execFileSync } from 'node:child_process';
import type { Session } from './types.js';

/** One commit, as `readCommits` parses it out of `git log`. */
export interface Commit {
  hash: string;
  /** Author date. Stable across a rebase; committer date is not. */
  at: string;
  subject: string;
}

const FORMAT = '%h%x1f%aI%x1f%s';

/**
 * The repository's commits, for pairing each session with work done during it.
 *
 * Failure is silent and returns nothing: extraction must not depend on git
 * being present, on the tree being a repository, or on any commit existing.
 */
export function readCommits(
  cwd: string,
  runGit: (cwd: string) => string = (dir) =>
    execFileSync('git', ['log', `--format=${FORMAT}`], {
      cwd: dir,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
): Commit[] {
  let out: string;
  try {
    out = runGit(cwd);
  } catch {
    return [];
  }

  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [hash, at, ...rest] = line.split('\x1f');
      return { hash: hash ?? '', at: at ?? '', subject: rest.join('\x1f') };
    })
    .filter((commit) => commit.hash !== '' && commit.at !== '');
}

/**
 * Commits authored between a session's first and last record, oldest first.
 *
 * Read as "committed while this session was open", which is not the same claim
 * as "committed by this session" — a commit made by hand mid-session lands here
 * too, and two concurrent sessions both list what falls in the overlap.
 *
 * A window rather than the `Claude-Session` commit trailer, which looks like
 * the exact key for this: that id appears nowhere structural in a log. It shows
 * up only inside conversation content — in the text of a commit command, in
 * `git log` output pasted back as a tool result, in prose discussing it — so a
 * session quoting another session's id offers two candidates and no way to
 * choose. A window is less precise and does not lie about its precision.
 */
export function commitsInWindow(commits: Commit[], session: Session): Commit[] {
  const { startedAt, endedAt } = session;
  if (startedAt === undefined || endedAt === undefined) return [];

  const start = Date.parse(startedAt);
  const end = Date.parse(endedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];

  return commits
    .filter((commit) => {
      const at = Date.parse(commit.at);
      return !Number.isNaN(at) && at >= start && at <= end;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

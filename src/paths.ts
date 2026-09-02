import { homedir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Where Claude Code keeps its session logs.
 *
 * Takes `home` as a parameter rather than calling `homedir()` at the point of
 * use. Nothing below the CLI layer may read the environment, the home
 * directory, or the clock — CI has no `~/.claude/projects` and must never grow
 * one, so every test reads checked-in fixtures instead. Retrofitting that later
 * reaches every call site at once; doing it first costs nothing.
 */
export function defaultLogRoot(home: string = homedir()): string {
  return join(home, '.claude', 'projects');
}

/**
 * Claude Code encodes a project path into a directory name by replacing every
 * path separator with a hyphen: `/Users/a/p` becomes `-Users-a-p`.
 *
 * Exported for documentation and for building a fast-path guess, never for
 * decoding. The encoding is lossy — a path containing a hyphen is
 * indistinguishable from one containing a separator — so the direction that
 * matters, name back to path, is not recoverable. Project membership is decided
 * by reading `cwd` out of the records instead.
 */
export function encodeProjectDir(projectPath: string): string {
  return projectPath.replace(/\/+$/, '').replace(/\//g, '-');
}

/**
 * True when `candidate` is `root` or lives beneath it.
 *
 * Descendant rather than equality, which covers two real cases: Claude Code
 * launched from a subdirectory, which lands in a differently-named project
 * directory; and worktrees, which `relocated` records point at under
 * `<project>/.claude/worktrees/`.
 */
export function isWithin(root: string, candidate: string): boolean {
  const from = resolve(root);
  const to = resolve(candidate);
  if (from === to) return true;
  const rel = relative(from, to);
  return (
    rel !== '' &&
    !rel.startsWith('..') &&
    !rel.startsWith(sep) &&
    !rel.includes(`..${sep}`)
  );
}

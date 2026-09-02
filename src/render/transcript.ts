import { stringify as stringifyYaml } from 'yaml';
import type { Commit } from '../commits.js';
import type { Session } from '../types.js';

export interface RenderTranscriptOptions {
  /**
   * The `extracted:` date, `YYYY-MM-DD`.
   *
   * A parameter, never read from the clock here. The renderer is pure: given
   * the same session and the same date it produces the same bytes, which is
   * what lets the writer decide whether anything actually changed before
   * stamping a new date. See specification §9.
   */
  extractedOn: string;
  /** Project root, recorded so a transcript says where it came from. */
  project?: string;
  /** Commits made while the session was open. Omitted when empty. */
  commits?: Commit[];
}

/** The frontmatter block, as an object, before serialization. */
export function frontmatterFor(
  session: Session,
  options: RenderTranscriptOptions,
): Record<string, unknown> {
  const commits = options.commits ?? [];

  return {
    title: session.title,
    session_id: session.id,
    ...(options.project !== undefined ? { project: options.project } : {}),
    source: 'claude-code',
    created: session.created,
    updated: session.updated,
    turns: session.turns.length,
    extracted: options.extractedOn,
    ...(session.kind !== undefined ? { kind: session.kind } : {}),
    ...(session.continuedIn !== undefined ? { continued_in: session.continuedIn } : {}),
    ...(session.continues !== undefined ? { continues: session.continues } : {}),
    // `<hash> <subject>` so the hash is greppable: `grep -l <hash> *.md` runs
    // the link the other way.
    ...(commits.length > 0
      ? { commits_in_window: commits.map((c) => `${c.hash} ${c.subject}`) }
      : {}),
  };
}

/** One session as markdown. Pure: no clock, no filesystem, no environment. */
export function renderTranscript(
  session: Session,
  options: RenderTranscriptOptions,
): string {
  const frontmatter = stringifyYaml(frontmatterFor(session, options));
  const parts = [`---\n${frontmatter}---`, '', `# ${session.title}`];

  session.turns.forEach((turn, index) => {
    parts.push('', `## [${index + 1}] ${turn.speaker}`, '', turn.text);
  });

  return `${parts.join('\n').replace(/\n{3,}$/, '\n')}\n`;
}

/** The leading `---\n...\n---\n` block, and only the leading one. */
const FRONTMATTER = /^---\n([\s\S]*?\n)---\n/;
const EXTRACTED_LINE = /^extracted:.*$/m;

/**
 * The `extracted:` value already on disk, or null.
 *
 * Scoped to the leading frontmatter block, never applied to the body. A
 * transcript body is arbitrary prose that may well contain `extracted:` at the
 * start of a line — quoted frontmatter, a discussion of this very field — and a
 * body-wide search would read the wrong one.
 */
export function readExtractedDate(existing: string): string | null {
  const block = FRONTMATTER.exec(existing)?.[1];
  if (block === undefined) return null;
  const line = EXTRACTED_LINE.exec(block)?.[0];
  if (line === undefined) return null;
  const value = line.slice('extracted:'.length).trim();
  return value === '' ? null : value;
}

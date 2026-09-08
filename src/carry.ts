import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parityReport, type ParityReport } from './turns.js';
import type { Speaker } from './types.js';

/**
 * A transcript read back off disk, for an index row this run cannot regenerate.
 *
 * The logs are ephemeral and the output is the durable record (specification
 * §10.4) — but the index was the one output that did not honour that. It was
 * rendered purely from the sessions discovered this run, so moving a project to
 * a new machine, where `~/.claude/projects` is empty of everything older,
 * rewrote `index.md` down to whatever that machine happens to hold. The
 * transcripts themselves survived; only the table that made them findable did
 * not, along with the measured alternation counts over them.
 *
 * Everything a row needs is already in the file: title, id, created and turn
 * count in the frontmatter, and the alternation of speakers in the turn
 * headings. So the fix is to read it back rather than to keep a second copy of
 * it somewhere. A sidecar stats file would work going forward and would be
 * cheaper to parse, but it cannot recover a row lost before it existed, and it
 * introduces a second source of truth that can disagree with the file next to
 * it about a transcript that is right there.
 */
export interface CarriedTranscript {
  /** The file it was read from, relative to the output directory. */
  filename: string;
  id: string;
  title: string;
  /** `YYYY-MM-DD`, as the frontmatter records it. */
  created: string;
  turns: number;
  /**
   * Alternation re-measured from the turn headings, or null when the headings
   * could not be trusted (see `readTurnHeadings`). Null means "not counted",
   * never "no breaks" — a fabricated zero would quietly improve a number the
   * index presents as measured.
   */
  parity: ParityReport | null;
  /** Image filenames the body links to. */
  images: string[];
}

/** The leading `---\n...\n---\n` block, and only the leading one. */
const FRONTMATTER = /^---\n([\s\S]*?\n)---\n/;

/** `## [7] Human`, as `renderTranscript` writes it. */
const TURN_HEADING = /^## \[(\d+)\] (Human|Assistant)$/gm;

/** A markdown image link with a relative target. */
const IMAGE_LINK = /!\[[^\]]*\]\((?!\w+:)([^()\s]+)\)/g;

/** `<date>--<slug>--<8 hex>.md`, the shape `sessionFilename` writes. */
const TRANSCRIPT_NAME = /^\d{4}-\d{2}-\d{2}--.+--[0-9a-f]{8}\.md$/;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Speakers in order, from the turn headings — or null when they do not add up.
 *
 * A transcript body is arbitrary prose, and in a project that documents this
 * tool it is prose that quotes turn headings. So the headings are only believed
 * when they number themselves 1..n with no gaps and their count agrees with the
 * frontmatter's `turns:`. Anything else means something in the body matched, and
 * a half-parsed speaker sequence would report alternation breaks that are not
 * there — worse than reporting nothing, because the index presents these counts
 * as measured.
 */
export function readTurnHeadings(body: string, declared?: number): Speaker[] | null {
  const speakers: Speaker[] = [];

  TURN_HEADING.lastIndex = 0;
  for (let m = TURN_HEADING.exec(body); m !== null; m = TURN_HEADING.exec(body)) {
    if (Number(m[1]) !== speakers.length + 1) return null;
    speakers.push(m[2] as Speaker);
  }

  if (declared !== undefined && declared !== speakers.length) return null;
  return speakers;
}

/** Image filenames a transcript body links to. */
export function readImageLinks(body: string): string[] {
  const names = new Set<string>();

  IMAGE_LINK.lastIndex = 0;
  for (let m = IMAGE_LINK.exec(body); m !== null; m = IMAGE_LINK.exec(body)) {
    // Matched by basename rather than by path, because `renderImage` hardcodes
    // an `images/` prefix that a configured `imageDir` does not change. The
    // cost is that an unrelated link in prose can name a file in the image
    // directory and keep it off the orphan report; the error therefore falls on
    // the side of not reporting an orphan, which is the side nothing is deleted
    // from anyway.
    if (m[1] !== undefined) names.add(basename(m[1]));
  }

  return [...names];
}

/** One transcript's frontmatter and headings, or null when it is not one. */
export function parseTranscript(
  filename: string,
  text: string,
): CarriedTranscript | null {
  const block = FRONTMATTER.exec(text)?.[1];
  if (block === undefined) return null;

  let front: unknown;
  try {
    front = parseYaml(block);
  } catch {
    // A hand-edited transcript with broken frontmatter is skipped, not fatal:
    // one unreadable file must not take the whole index down with it.
    return null;
  }

  if (typeof front !== 'object' || front === null) return null;
  const fields = front as Record<string, unknown>;

  const id = fields.session_id;
  const title = fields.title;
  const created = fields.created;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string' || title === '') return null;
  if (typeof created !== 'string' || !DATE.test(created)) return null;

  const declared = typeof fields.turns === 'number' ? fields.turns : undefined;
  const body = text.slice(FRONTMATTER.exec(text)?.[0].length ?? 0);
  const speakers = readTurnHeadings(body, declared);

  return {
    filename,
    id,
    title,
    created,
    turns: declared ?? speakers?.length ?? 0,
    parity:
      speakers === null
        ? null
        : parityReport(speakers.map((s) => ({ speaker: s, text: '' }))),
    images: readImageLinks(body),
  };
}

/**
 * Every transcript already in the output directory.
 *
 * Read-only, and deliberately not filtered here: the caller decides which rows
 * to carry into the index, and the image scan wants all of them regardless.
 */
export function readTranscripts(outDir: string): CarriedTranscript[] {
  if (!existsSync(outDir)) return [];

  const found: CarriedTranscript[] = [];
  for (const name of readdirSync(outDir).sort()) {
    if (!TRANSCRIPT_NAME.test(name)) continue;
    const parsed = parseTranscript(name, readFileSync(join(outDir, name), 'utf8'));
    if (parsed !== null) found.push(parsed);
  }
  return found;
}

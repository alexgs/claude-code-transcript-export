import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { readExtractedDate } from './render/transcript.js';
import type { SessionImage } from './types.js';

/**
 * Writes `render(date)` to `path` unless the file there already says the same
 * thing. Returns whether it wrote.
 *
 * The date is preserved when the content around it is identical, so
 * `extracted:` comes to mean "the day this transcript last changed" rather than
 * "the day the extractor last ran". Without that, a rerun touches every
 * transcript and the resulting commit is a wall of one-line diffs with nothing
 * in it — the shape of a diff nobody reads, in the one directory where a real
 * change to an old transcript would matter.
 *
 * Takes a render *function* rather than a string so the prior date can be fed
 * back in. The renderer stays pure; the impurity lives here, where the I/O
 * already is.
 */
export function writeIfChanged(
  path: string,
  render: (extractedOn: string) => string,
  today: string,
): boolean {
  if (existsSync(path)) {
    const existing = readFileSync(path, 'utf8');
    const prior = readExtractedDate(existing);
    if (prior !== null && render(prior) === existing) return false;
  }

  writeFileSync(path, render(today));
  return true;
}

/** Writes a file only when its bytes differ. For output with no date header. */
export function writePlainIfChanged(path: string, contents: string): boolean {
  if (existsSync(path) && readFileSync(path, 'utf8') === contents) return false;
  writeFileSync(path, contents);
  return true;
}

/**
 * Writes images that are not already on disk.
 *
 * Filenames are content hashes, so an existing file with the right name always
 * has the right bytes and never needs rewriting.
 */
export function writeImages(dir: string, images: SessionImage[]): string[] {
  if (images.length === 0) return [];
  mkdirSync(dir, { recursive: true });

  const written: string[] = [];
  for (const image of images) {
    const path = join(dir, image.filename);
    if (existsSync(path)) continue;
    writeFileSync(path, image.data);
    written.push(image.filename);
  }
  return written;
}

/** `<date>--<slug>--<8 hex>.md`, the shape `sessionFilename` writes. */
const TRANSCRIPT_NAME = /^\d{4}-\d{2}-\d{2}--.+--([0-9a-f]{8})\.md$/;

/**
 * Deletes transcripts left behind when a session was renamed.
 *
 * A filename is built from the session's title, and a title is whatever the
 * last `custom-title` or `ai-title` record says. Sessions get renamed as they
 * go, so a session extracted twice across a rename lands under two names.
 * Writing never removes the first, and the stale copy stays: a truncated
 * transcript that reads exactly like evidence, absent from the index, citable
 * by anyone who finds it.
 *
 * **Scoped to renames, never a directory sync.** A file is removed only when
 * this run wrote a different name for the same session id. The logs are
 * ephemeral and the output is the durable record, so a transcript whose JSONL
 * has since been pruned must survive; a sync would delete precisely the
 * transcripts that can no longer be regenerated.
 */
export function pruneRenamed(outDir: string, written: string[]): string[] {
  if (!existsSync(outDir)) return [];

  const keep = new Set(written);
  const writtenIds = new Set(
    written.map((name) => TRANSCRIPT_NAME.exec(name)?.[1]).filter(Boolean),
  );

  const removed = readdirSync(outDir)
    .filter((name) => !keep.has(name))
    .filter((name) => {
      const id = TRANSCRIPT_NAME.exec(name)?.[1];
      return id !== undefined && writtenIds.has(id);
    })
    .sort();

  for (const name of removed) rmSync(join(outDir, name));
  return removed;
}

/**
 * Deletes transcripts for sessions the config now excludes.
 *
 * Without this, adding a UUID to `exclude` does nothing to what is already on
 * disk, which is the opposite of what the user asked for.
 */
export function pruneExcluded(outDir: string, excludedIds: string[]): string[] {
  if (!existsSync(outDir) || excludedIds.length === 0) return [];

  const prefixes = new Set(excludedIds.map((id) => id.slice(0, 8)));
  const removed = readdirSync(outDir)
    .filter((name) => {
      const id = TRANSCRIPT_NAME.exec(name)?.[1];
      return id !== undefined && prefixes.has(id);
    })
    .sort();

  for (const name of removed) rmSync(join(outDir, name));
  return removed;
}

/**
 * Images in `imageDir` that no transcript references.
 *
 * **Reported, never deleted.** Content-hash naming makes "unreferenced" an
 * exact fact rather than a guess, so the report is trustworthy — but an image
 * is the one output that cannot be regenerated once its log is pruned, which
 * puts it on the wrong side of the rule that this tool never deletes what it
 * cannot rebuild.
 */
export function findOrphanImages(imageDir: string, referenced: Set<string>): string[] {
  if (!existsSync(imageDir)) return [];
  return readdirSync(imageDir)
    .filter((name) => !referenced.has(name))
    .sort();
}

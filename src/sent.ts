import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { EXTENSIONS, humanSize, isRecord, type RenderContext } from './content.js';
import type { RawRecord } from './types.js';

/**
 * Files the assistant sent to the author with `SendUserFile`, and where their
 * bytes come from. See specification 04.
 *
 * The call's result record carries the caption and each file's path, size,
 * media type and `file_uuid` — but never the bytes. Those have to be found:
 * in an earlier `Read` of the same path, which does put an image into the log,
 * or failing that in the file itself, which is usually somewhere in `/tmp`.
 */

/** One file a `SendUserFile` call delivered, as its result records it. */
export interface SentAttachment {
  path: string;
  /** Bytes on disk at the moment it was sent. Every copy is checked against it. */
  size?: number;
  mediaType?: string;
  isImage: boolean;
  fileUuid?: string;
}

export interface SentFiles {
  caption: string;
  attachments: SentAttachment[];
}

/**
 * The files a record reports as sent, or `null` for anything else.
 *
 * Recognized by the shape of `toolUseResult` alone, as the question widget is:
 * an `attachments` list whose entries name a path. Observed, not documented
 * (§3.1). A failed send leaves an error string there instead, and renders
 * nothing — the assistant's next text says what went wrong anyway.
 */
export function sentFiles(record: RawRecord): SentFiles | null {
  if (record.type !== 'user') return null;
  const result = record.toolUseResult;
  if (!isRecord(result) || !Array.isArray(result.attachments)) return null;

  const attachments: SentAttachment[] = [];
  for (const raw of result.attachments) {
    if (!isRecord(raw) || typeof raw.path !== 'string' || raw.path === '') continue;
    attachments.push({
      path: raw.path,
      size: typeof raw.size === 'number' ? raw.size : undefined,
      mediaType: typeof raw.media_type === 'string' ? raw.media_type : undefined,
      isImage: raw.isImage === true,
      fileUuid: typeof raw.file_uuid === 'string' ? raw.file_uuid : undefined,
    });
  }
  if (attachments.length === 0) return null;

  return {
    caption: typeof result.caption === 'string' ? result.caption.trim() : '',
    attachments,
  };
}

/** An image the log holds because the assistant `Read` it. */
interface LogCopy {
  bytes: Buffer;
  mediaType: string;
  /** Size of the file that was read, before any downscaling. */
  originalSize?: number;
}

/**
 * Images the assistant has `Read` so far in a session, by path.
 *
 * Fed every record in order, so a lookup sees only reads that happened *before*
 * the send. That matters: scratch renders get overwritten under the same name
 * as the work goes, and the observed session sent `stack-crop.png` after
 * reading three different versions of it.
 */
export class ImageReads {
  private readonly pathsById = new Map<string, string>();
  private readonly copies = new Map<string, LogCopy[]>();

  observe(record: RawRecord): void {
    const content = record.message?.content;
    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (block?.type === 'tool_use' && block.name === 'Read') {
        const input = block.input;
        if (typeof block.id === 'string' && isRecord(input)) {
          if (typeof input.file_path === 'string') {
            this.pathsById.set(block.id, input.file_path);
          }
        }
        continue;
      }

      if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string')
        continue;
      const path = this.pathsById.get(block.tool_use_id);
      if (path === undefined || !Array.isArray(block.content)) continue;

      for (const inner of block.content as unknown[]) {
        if (!isRecord(inner) || inner.type !== 'image' || !isRecord(inner.source))
          continue;
        const { data, media_type: mediaType } = inner.source;
        if (typeof data !== 'string' || data === '' || typeof mediaType !== 'string') {
          continue;
        }
        const list = this.copies.get(path) ?? [];
        list.push({
          bytes: Buffer.from(data, 'base64'),
          mediaType,
          originalSize: originalSizeOf(record),
        });
        this.copies.set(path, list);
      }
    }
  }

  /** Copies of `path` read so far, newest first. */
  copiesOf(path: string): LogCopy[] {
    return [...(this.copies.get(path) ?? [])].reverse();
  }
}

/** `toolUseResult.file.originalSize` of an image `Read`, when present. */
function originalSizeOf(record: RawRecord): number | undefined {
  const result = record.toolUseResult;
  if (!isRecord(result) || !isRecord(result.file)) return undefined;
  const size = result.file.originalSize;
  return typeof size === 'number' ? size : undefined;
}

/** Wraps text in a code span long enough to contain its own backticks. */
function codeSpan(text: string): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const ticks = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${ticks}${pad}${text}${pad}${ticks}`;
}

/**
 * `<id8>-<uuid8>.<ext>`, or `undefined` when the send recorded no usable uuid.
 *
 * **Named by the delivery, not by content hash**, unlike a pasted image. A name
 * derived from the bytes can only be found again by someone holding the bytes,
 * and the whole point of a rerun here is that it may not: the file in `/tmp`
 * is gone, the log never had it, and the copy an earlier run made is the only
 * one left. A name derivable from the log alone is what lets that rerun link
 * the existing file instead of degrading the transcript to a marker.
 */
function deliveryName(
  context: RenderContext,
  attachment: SentAttachment,
  extension: string,
): string | undefined {
  const uuid8 = attachment.fileUuid?.slice(0, 8);
  if (uuid8 === undefined || !/^[0-9a-f]{8}$/i.test(uuid8)) return undefined;
  return `${context.sessionId8 ?? 'session'}-${uuid8.toLowerCase()}.${extension}`;
}

/**
 * One sent image as a link to an extracted file, or a marker.
 *
 * Sources, in order:
 *
 * 1. **A `Read` of the same path whose bytes are exactly the size sent.** The
 *    log is the only source that is the same on every machine and every day.
 * 2. **The copy a previous run already extracted.** Ahead of the original on
 *    disk, so a scratch file overwritten after the fact — same name, perhaps
 *    even the same size — can never replace what was captured.
 * 3. **The original file**, only when it is still exactly the size sent.
 * 4. **A `Read` of the same path that was downscaled** — `Read` caps images at
 *    2000px on the long edge. What the assistant saw, which beats nothing, but
 *    ranked below the real file.
 *
 * Nothing is ever deleted here. When all four come up empty the transcript
 * says so, and an image an earlier run wrote stays on disk regardless.
 */
function renderSentImage(
  attachment: SentAttachment,
  reads: ImageReads,
  context: RenderContext,
): string {
  const media = attachment.mediaType ?? 'unknown';
  const extension = EXTENSIONS[media];
  const size = attachment.size === undefined ? '' : `, ${humanSize(attachment.size)}`;

  if (context.policy?.images === 'marker' || extension === undefined) {
    return `> [image: ${media}${size}]`;
  }

  const { size: expected } = attachment;
  const copies = reads.copiesOf(attachment.path).filter((c) => c.mediaType === media);
  const stable = deliveryName(context, attachment, extension);

  const bytes =
    (expected === undefined
      ? undefined
      : copies.find((c) => c.bytes.byteLength === expected)?.bytes) ??
    (stable === undefined ? undefined : context.sources?.readExtracted(stable)) ??
    (expected === undefined
      ? undefined
      : context.sources?.readOriginal(attachment.path, expected)) ??
    copies.find((c) => expected === undefined || c.originalSize === expected)?.bytes;

  if (bytes === undefined) {
    return `> [image: ${media}${size}, not in the log or on disk]`;
  }

  const filename =
    stable ??
    `${context.sessionId8 ?? 'session'}-${createHash('sha256')
      .update(bytes)
      .digest('hex')
      .slice(0, 8)}.${extension}`;

  if (context.collected && !context.collected.some((i) => i.filename === filename)) {
    context.collected.push({ filename, mediaType: media, data: bytes });
  }

  // Brackets are dropped from the alt text rather than escaped: `carry.ts`
  // finds image links with a pattern that stops at the first `]`.
  const alt = basename(attachment.path).replace(/[[\]]/g, '');
  return `![${alt}](images/${filename})`;
}

/**
 * A `SendUserFile` result as markdown, or `null` when the record is not one.
 *
 * Rendered whatever `tools` says, for the reason an answered question widget
 * is (specification 02): §6.1 drops tool traffic because what it authors lands
 * in the working tree, and a scratch render in `/tmp` never does. The caption
 * is the assistant saying what the image shows — often the finding itself.
 *
 * Every file is listed by path, image or not; images follow their path, and
 * the caption comes last, the way it reads under the files in the app.
 */
export function renderSentFiles(
  record: RawRecord,
  reads: ImageReads,
  context: RenderContext = {},
): string | null {
  const sent = sentFiles(record);
  if (sent === null) return null;

  const parts: string[] = [];
  for (const attachment of sent.attachments) {
    parts.push(`Sent ${codeSpan(attachment.path)}`);
    if (attachment.isImage) parts.push(renderSentImage(attachment, reads, context));
  }
  if (sent.caption !== '') parts.push(sent.caption);

  return parts.join('\n\n');
}

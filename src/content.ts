import { createHash } from 'node:crypto';
import type { ContentPolicy, RawBlock, RawRecord, SessionImage } from './types.js';
import { DEFAULT_CONTENT_POLICY } from './types.js';

/**
 * Harness scaffolding wrapped around a human turn — a slash command's
 * expansion, the caveat block preceding it, an injected reminder. Not authored
 * prose; a record that is only this is not a turn at all.
 */
const HARNESS_TAGS = [
  'local-command-caveat',
  'local-command-stdout',
  'command-name',
  'command-message',
  'command-args',
  'system-reminder',
] as const;

const PAIRED = new RegExp(`<(${HARNESS_TAGS.join('|')})>[\\s\\S]*?</\\1>`, 'g');
const UNPAIRED = new RegExp(`</?(${HARNESS_TAGS.join('|')})>`, 'g');

/**
 * Text with harness scaffolding removed, contents and all.
 *
 * The command *name* goes with the rest, deliberately. Leaving it behind turns
 * `/clear` into a one-word human turn — something the author never said — and
 * shifts every turn number after it.
 */
export function stripHarnessTags(text: string): string {
  return text.replace(PAIRED, '').replace(UNPAIRED, '').trim();
}

/**
 * Wraps content in a fence long enough to contain it. Tool payloads carry
 * markdown, which carries its own fences; a fixed ``` would let one break out.
 */
export function fence(content: string, info: string): string {
  let longest = 0;
  for (const run of content.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return `${ticks}${info}\n${content}\n${ticks}`;
}

/** Title lowercased, non-alphanumerics collapsed to hyphens, truncated to 60. */
export function slugify(title: string): string {
  const collapsed = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return collapsed.slice(0, 60).replace(/-+$/, '') || 'untitled';
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** Bytes in a human-readable size, for the marker form. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface RenderContext {
  policy?: ContentPolicy;
  /** First 8 characters of the session id, for naming extracted images. */
  sessionId8?: string;
  /** Images found while rendering are pushed here for the writer to persist. */
  collected?: SessionImage[];
}

/**
 * One image block as either a link to an extracted file or a marker.
 *
 * Naming by content hash is what keeps reruns stable: identical bytes always
 * produce an identical filename, so the same screenshot pasted twice is stored
 * once and a rerun rewrites nothing. An unrecognized media type falls back to
 * a marker rather than guessing an extension.
 */
export function renderImage(block: RawBlock, context: RenderContext): string {
  const media = block.source?.media_type ?? 'unknown';
  const data = block.source?.data;

  if (typeof data !== 'string' || data === '') {
    return `> [image: ${media}, no data]`;
  }

  const bytes = Buffer.from(data, 'base64');
  const extension = EXTENSIONS[media];

  if (context.policy?.images === 'marker' || extension === undefined) {
    return `> [image: ${media}, ${humanSize(bytes.byteLength)}]`;
  }

  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const filename = `${context.sessionId8 ?? 'session'}-${hash}.${extension}`;

  if (context.collected && !context.collected.some((i) => i.filename === filename)) {
    context.collected.push({ filename, mediaType: media, data: bytes });
  }

  return `![pasted image](images/${filename})`;
}

/**
 * One content block as markdown, or `null` when policy drops it.
 *
 * - `text` — verbatim.
 * - `thinking` — dropped by default. Exploratory reasoning misleads a later
 *   reader: a hypothesis the assistant talked itself out of reads like a
 *   proposal if you find it out of context.
 * - `tool_use` / `tool_result` — dropped by default. Anything authored in a
 *   Claude Code session lands in the working tree and is captured by the
 *   commit, so the payload is redundant with git while making up most of the
 *   raw bytes.
 * - `image` — extracted to a file, or a marker.
 * - anything else — a visible marker, never a silent drop.
 */
export function renderBlock(
  block: RawBlock,
  context: RenderContext = {},
): string | null {
  const policy = context.policy ?? DEFAULT_CONTENT_POLICY;

  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? block.text : '';

    case 'thinking':
      return policy.thinking === 'keep'
        ? fence(typeof block.thinking === 'string' ? block.thinking : '', 'thinking')
        : null;

    case 'tool_use': {
      if (policy.tools === 'strip') return null;
      const name = typeof block.name === 'string' ? block.name : 'unknown';
      return fence(JSON.stringify(block.input ?? null, null, 2), `tool_use:${name}`);
    }

    case 'tool_result': {
      if (policy.tools === 'strip') return null;
      const name = typeof block.name === 'string' ? block.name : 'unknown';
      return fence(
        JSON.stringify(block.content ?? null, null, 2),
        `tool_result:${name}`,
      );
    }

    case 'image':
      return renderImage(block, context);

    default:
      return `> [unhandled block type: ${block.type ?? 'undefined'}]`;
  }
}

/** The text of one record under the given policy. */
export function recordText(record: RawRecord, context: RenderContext = {}): string {
  const content = record.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  return content
    .map((block) => renderBlock(block, context))
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join('\n\n')
    .trim();
}

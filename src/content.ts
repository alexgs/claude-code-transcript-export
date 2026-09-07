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

/**
 * The `toolUseResult` of an answered `AskUserQuestion` — the question widget.
 *
 * Shape observed, not documented, like everything else here (§3.1). `answers`
 * maps each question's text to the label of the option the author picked, to
 * their own prose when they took "Other", or to a comma-joined list when the
 * question allowed several. `annotations` is keyed by the same question text
 * and may carry `notes`: further prose typed alongside the selection.
 */
interface AnsweredQuestions {
  answers: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The answered-widget payload of a record, or `null` for anything else.
 *
 * Both `questions` and `answers` are required. A dismissed widget — the author
 * hit escape and typed instead — carries a plain error string here, and a
 * rejected one carries no answers; neither is a turn, and the prose the author
 * typed instead arrives as an ordinary `user` record anyway.
 */
function answeredQuestions(record: RawRecord): AnsweredQuestions | null {
  const result = record.toolUseResult;
  if (!isRecord(result)) return null;
  if (!Array.isArray(result.questions)) return null;
  if (!isRecord(result.answers)) return null;

  return {
    answers: result.answers,
    annotations: isRecord(result.annotations) ? result.annotations : undefined,
  };
}

/** One answer as a line. Lists arrive joined already; defend anyway. */
function answerText(answer: unknown): string {
  if (Array.isArray(answer)) return answer.map((a) => String(a).trim()).join(', ');
  return typeof answer === 'string' ? answer.trim() : '';
}

/** Prose as a blockquote, blank lines included so the quote stays one block. */
function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * An answered question widget as markdown, or `null` when the record is not
 * one.
 *
 * **This is authored content that exists nowhere else in the log**, which is
 * why it survives `tools: strip`. The default in §6.1 rests on tool payloads
 * being redundant with git — anything authored through a tool lands in the
 * working tree and the commit captures it. That argument does not reach here.
 * Across the corpus this was written against, 10 of 66 answers are free text
 * the author typed into "Other" and 5 widgets carry `notes`; a transcript that
 * drops them loses a decision the rest of the session then proceeds on. The
 * argument for keeping it is the same argument §1 makes for images.
 *
 * The question text is rendered because an answer without it is unreadable.
 * The options *not* taken are not: they are assistant prose, and the turns
 * around the widget generally restate whatever mattered about them.
 */
export function renderAnsweredQuestions(record: RawRecord): string | null {
  const result = answeredQuestions(record);
  if (result === null) return null;

  const parts: string[] = [];

  for (const [question, answer] of Object.entries(result.answers)) {
    const text = answerText(answer);
    if (text === '') continue;

    // Newlines collapse: the question is one string in the widget, and a
    // literal newline inside `**...**` would break the emphasis in half.
    parts.push(`**${question.replace(/\s+/g, ' ').trim()}**\n\n${text}`);

    const annotation = result.annotations?.[question];
    const notes = isRecord(annotation) ? annotation.notes : undefined;
    if (typeof notes === 'string' && notes.trim() !== '') {
      parts.push(blockquote(notes.trim()));
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * The text of one record under the given policy.
 *
 * An answered question widget replaces its own `tool_result` block rather than
 * rendering alongside it: under `tools: keep` the raw payload would otherwise
 * repeat every question and answer a second time as JSON.
 */
export function recordText(record: RawRecord, context: RenderContext = {}): string {
  const content = record.message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';

  const answered = renderAnsweredQuestions(record);

  const parts = content
    .map((block) =>
      answered !== null && block?.type === 'tool_result'
        ? null
        : renderBlock(block, context),
    )
    .filter((part): part is string => part !== null && part.trim() !== '');

  return (answered !== null ? [answered, ...parts] : parts).join('\n\n').trim();
}

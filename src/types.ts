/**
 * Types for the Claude Code JSONL log format.
 *
 * Every field is optional. The schema is undocumented, observed rather than
 * guaranteed, and has drifted before: see the specification's §3.1 for two
 * changes that reversed design decisions during drafting. Nothing here should
 * be read as a promise about what a record contains.
 */

/** One content block inside a message. */
export interface RawBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  source?: {
    type?: string;
    media_type?: string;
    data?: string;
  };
  [key: string]: unknown;
}

/** One JSONL line. */
export interface RawRecord {
  type?: string;
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  isMeta?: boolean;
  isSidechain?: boolean;
  sessionKind?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  /** `ai-title` records: the model's name for the session. */
  aiTitle?: string;
  /** `custom-title` records: the name a human set, which wins. */
  customTitle?: string;
  /** `agent-name` records: a background job's name. Last-resort title. */
  agentName?: string;
  /** `continued-in` records: the session this one was continued into. */
  continuedInSessionId?: string;
  /** `relocated` records: a working directory the session moved to. */
  relocatedCwd?: string;
  message?: { role?: string; content?: RawBlock[] | string };
  /**
   * Structured result of the tool call this record answers, alongside the
   * `tool_result` block. Read for three tools: `AskUserQuestion`, whose
   * `{ questions, answers, annotations }` is the only place an author's widget
   * selection is recorded (see `renderAnsweredQuestions`); `SendUserFile`,
   * whose `{ caption, attachments }` names the files the assistant sent (see
   * `sent.ts`); and an image `Read`, for the size of the file it read.
   */
  toolUseResult?: unknown;
  [key: string]: unknown;
}

export type Speaker = 'Human' | 'Assistant';

export interface SessionTurn {
  speaker: Speaker;
  text: string;
}

/** An image lifted out of a transcript, ready to be written. */
export interface SessionImage {
  /**
   * `<id8>-<hash8>.<ext>` for a pasted image: content-addressed, so reruns
   * never duplicate. `<id8>-<uuid8>.<ext>` for a sent file, named by its
   * delivery so a rerun can find it without the bytes (see `sent.ts`).
   */
  filename: string;
  mediaType: string;
  /** Decoded bytes. The writer is responsible for putting them on disk. */
  data: Buffer;
}

export interface Session {
  id: string;
  title: string;
  /** Local-time `YYYY-MM-DD`. */
  created: string;
  updated: string;
  /** First and last record timestamps, full precision. */
  startedAt?: string;
  endedAt?: string;
  /** `sessionKind`, e.g. `bg`. Recorded because it is true; drives nothing. */
  kind?: string;
  /** From a `continued-in` record. */
  continuedIn?: string;
  /** Computed across the run, not read from a record. */
  continues?: string;
  /** Working directories seen, including relocations. */
  cwds: string[];
  turns: SessionTurn[];
  images: SessionImage[];
  /** user/assistant records seen before filtering. Reported, not rendered. */
  rawMessages: number;
}

/**
 * Filesystem lookups for a sent image the log does not hold.
 *
 * Injected, so everything that renders stays pure and the test suite never
 * touches a path a log names. `extract` supplies the real one; without it a
 * session renders from the log alone.
 */
export interface SentFileSources {
  /** An image a previous run already wrote to the image directory. */
  readExtracted(filename: string): Buffer | undefined;
  /** The file at the path it was sent from, only if it is still `size` bytes. */
  readOriginal(path: string, size: number): Buffer | undefined;
}

export type ToolPolicy = 'strip' | 'keep';
export type ThinkingPolicy = 'drop' | 'keep';
export type ImagePolicy = 'extract' | 'marker';

export interface ContentPolicy {
  tools: ToolPolicy;
  thinking: ThinkingPolicy;
  images: ImagePolicy;
}

export const DEFAULT_CONTENT_POLICY: ContentPolicy = {
  tools: 'strip',
  thinking: 'drop',
  images: 'extract',
};

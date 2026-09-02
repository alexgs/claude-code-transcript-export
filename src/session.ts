import { basename } from 'node:path';
import { recordText } from './content.js';
import type { RenderContext } from './content.js';
import { resolveTitle, toLocalDate } from './titles.js';
import { buildTurns } from './turns.js';
import type { ContentPolicy, RawRecord, Session, SessionImage } from './types.js';

/** The last non-empty value of a field across records of one type. */
function lastOf(
  records: RawRecord[],
  type: string,
  field: keyof RawRecord,
): string | undefined {
  let found: string | undefined;
  for (const record of records) {
    if (record.type === type && typeof record[field] === 'string') {
      const value = (record[field] as string).trim();
      if (value !== '') found = value;
    }
  }
  return found;
}

export interface ReadSessionOptions {
  policy?: ContentPolicy;
  /** Used when no record carries a session id. */
  fallbackId?: string;
}

/**
 * Records to a `Session`.
 *
 * Timestamps are kept at full precision alongside the local dates, because the
 * commit window needs to separate two sessions held on the same day.
 */
export function readSession(
  records: RawRecord[],
  options: ReadSessionOptions = {},
): Session {
  const conversational = records.filter(
    (record) => record.type === 'user' || record.type === 'assistant',
  );

  const stamps = records
    .map((record) => record.timestamp)
    .filter((stamp): stamp is string => typeof stamp === 'string')
    .sort();

  const id =
    records.find((record) => typeof record.sessionId === 'string')?.sessionId ??
    options.fallbackId ??
    'unknown';

  const cwds: string[] = [];
  for (const record of records) {
    for (const dir of [record.cwd, record.relocatedCwd]) {
      if (typeof dir === 'string' && dir !== '' && !cwds.includes(dir)) cwds.push(dir);
    }
  }

  const images: SessionImage[] = [];
  const context: RenderContext = {
    policy: options.policy,
    sessionId8: id.slice(0, 8),
    collected: images,
  };

  return {
    id,
    title: resolveTitle(records),
    created: toLocalDate(stamps[0]),
    updated: toLocalDate(stamps[stamps.length - 1]),
    startedAt: stamps[0],
    endedAt: stamps[stamps.length - 1],
    kind: lastOf(records, 'attachment', 'sessionKind') ?? findKind(records),
    continuedIn: lastOf(records, 'continued-in', 'continuedInSessionId'),
    cwds,
    turns: buildTurns(records, context),
    images,
    rawMessages: conversational.length,
  };
}

/** `sessionKind` rides on ordinary records, not on a record type of its own. */
function findKind(records: RawRecord[]): string | undefined {
  for (const record of records) {
    if (typeof record.sessionKind === 'string' && record.sessionKind !== '') {
      return record.sessionKind;
    }
  }
  return undefined;
}

/**
 * Fills in each session's `continues` — the reverse of `continuedIn`.
 *
 * Computed across the run rather than read from a record, because no record
 * points backwards. A long piece of work spans several session files, and
 * without both directions the transcript for the first half simply stops
 * mid-thought with nothing saying where it went.
 *
 * Mutates in place and returns the same array, since the sessions were just
 * built and nothing else holds them yet.
 */
export function linkContinuations(sessions: Session[]): Session[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));

  for (const session of sessions) {
    if (session.continuedIn === undefined) continue;
    const next = byId.get(session.continuedIn);
    if (next !== undefined) next.continues = session.id;
  }

  return sessions;
}

/** `<date>--<slug>--<id8>.md`. */
export function sessionFilename(
  session: Session,
  slugify: (s: string) => string,
): string {
  return `${session.created}--${slugify(session.title)}--${session.id.slice(0, 8)}.md`;
}

/** A log's filename without its extension, for use as a fallback session id. */
export function fallbackIdFor(path: string): string {
  return basename(path, '.jsonl');
}

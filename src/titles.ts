import type { RawRecord } from './types.js';

/**
 * A session's title, by precedence: `custom-title`, then `ai-title`, then
 * `agent-name`.
 *
 * Custom wins because it is the name a human deliberately set, and a session
 * the author renamed should not be filed under the model's name for it. Within
 * each kind the last record wins: several accumulate as a session is renamed
 * mid-flight, and the last one is the name the session ended up with.
 *
 * `agent-name` is the last resort — it is a background job's name, present in
 * 11 of 15 background logs in the observed corpus and rescuing one that has no
 * `ai-title` at all.
 */
export function resolveTitle(
  records: RawRecord[],
  fallback = 'Untitled session',
): string {
  const last = (type: string, field: keyof RawRecord): string | undefined => {
    let found: string | undefined;
    for (const record of records) {
      if (record.type === type && typeof record[field] === 'string') {
        const value = (record[field] as string).trim();
        if (value !== '') found = value;
      }
    }
    return found;
  };

  return (
    last('custom-title', 'customTitle') ??
    last('ai-title', 'aiTitle') ??
    last('agent-name', 'agentName') ??
    fallback
  );
}

/**
 * A timestamp as `YYYY-MM-DD` in **local time**.
 *
 * Local, not UTC, and the difference is not cosmetic. A session beginning
 * 2026-08-25T00:13Z is 17:13 on 2026-08-24 where the author was sitting, and
 * every other date a project cites — git commits above all — is local. Filed by
 * UTC it lands a day after the commit it produced, and a reader chasing "the
 * 8/24 session" finds nothing there.
 */
export function toLocalDate(timestamp: string | undefined): string {
  if (!timestamp) return 'unknown';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, '0');
  const day = `${parsed.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

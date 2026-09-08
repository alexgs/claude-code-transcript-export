import { aggregateParity, parityReport } from '../turns.js';
import type { CarriedTranscript } from '../carry.js';
import type { Session } from '../types.js';

export interface RenderIndexOptions {
  /** Project-specific prose, inserted verbatim. */
  preamble?: string | null;
  /** Sessions the config withheld. */
  excluded?: string[];
  listExcluded?: 'count' | 'ids' | 'none';
  /**
   * Rows read back from transcripts on disk whose logs this run did not see.
   *
   * Listing them is what keeps the index from shrinking to whatever machine it
   * was last generated on. See `carry.ts`.
   */
  carried?: CarriedTranscript[];
}

/** One row of the table, from either source. */
interface IndexRow {
  id: string;
  title: string;
  created: string;
  turns: number;
}

/**
 * A sentence about turn alternation, measured rather than asserted.
 *
 * "Odd turns are the author" is the kind of plausible claim a corpus gets
 * burned by, so it is checked on generation. Breaks are counted as adjacent
 * same-speaker pairs, not as index parity — a single break early in a long
 * session flips every turn after it, so index parity reports an order of
 * magnitude more breaks than exist.
 */
export function parityStatement(
  sessions: Session[],
  carried: CarriedTranscript[] = [],
): string {
  const totals = aggregateParity([
    ...sessions.map((s) => parityReport(s.turns)),
    // Carried transcripts are measured the same way, off their turn headings,
    // so a session whose log is gone still counts toward the claim the index
    // makes. The ones whose headings could not be trusted are left out and
    // said so, rather than counted as clean.
    ...carried.flatMap((c) => (c.parity === null ? [] : [c.parity])),
  ]);

  const unmeasured = carried.filter((c) => c.parity === null).length;
  const caveat =
    unmeasured === 0
      ? ''
      : ` ${unmeasured} carried-forward transcript${unmeasured === 1 ? '' : 's'} ` +
        `could not be re-measured from ${unmeasured === 1 ? 'its' : 'their'} ` +
        'turn headings and are not counted here.';

  if (totals.alternationBreaks === 0 && totals.sessionsNotStartingWithHuman === 0) {
    return (
      'Turns alternate without exception: odd turns are the author, even turns ' +
      'the assistant. Checked on generation, not assumed — so the speaker of ' +
      'turn N is known from N alone.' +
      caveat
    );
  }

  const parts: string[] = [];
  if (totals.alternationBreaks > 0) {
    parts.push(
      `${totals.alternationBreaks} place${totals.alternationBreaks === 1 ? '' : 's'} ` +
        'where two turns in a row share a speaker',
    );
  }
  if (totals.sessionsNotStartingWithHuman > 0) {
    parts.push(
      `${totals.sessionsNotStartingWithHuman} session${
        totals.sessionsNotStartingWithHuman === 1 ? '' : 's'
      } opening with an assistant turn`,
    );
  }

  // Agreement follows the count inside the clause, not the number of clauses:
  // one clause reading "2 places" still takes "are".
  const onlyCount =
    totals.alternationBreaks > 0 && totals.sessionsNotStartingWithHuman > 0
      ? 2
      : totals.alternationBreaks + totals.sessionsNotStartingWithHuman;
  const verb = parts.length === 1 && onlyCount === 1 ? 'is' : 'are';

  return (
    'Turns mostly alternate — odd the author, even the assistant — but there ' +
    `${verb} ${parts.join(' and ')}. ` +
    'Read the heading rather than inferring the speaker from the number.' +
    caveat
  );
}

/** The generated index. Pure. */
export function renderIndex(
  sessions: Session[],
  options: RenderIndexOptions = {},
): string {
  const excluded = options.excluded ?? [];
  const listExcluded = options.listExcluded ?? 'count';
  const carried = options.carried ?? [];

  // Both sources become the same kind of row, then sort together: a carried
  // transcript belongs in date order among the rest, not in a second table
  // below it. The reader is looking for a session, not for the machine its log
  // happened to be on.
  const rows = [
    ...sessions.map((s): IndexRow => ({
      id: s.id,
      title: s.title,
      created: s.created,
      turns: s.turns.length,
    })),
    ...carried.map((c): IndexRow => ({
      id: c.id,
      title: c.title,
      created: c.created,
      turns: c.turns,
    })),
  ]
    .sort((a, b) => `${a.created}${a.id}`.localeCompare(`${b.created}${b.id}`))
    .map((row) => {
      const title = row.title.replace(/\|/g, '\\|');
      return `| ${row.created} | ${title} | ${row.turns} | \`${row.id}\` |`;
    });

  const lines: string[] = [
    '# Claude Code sessions',
    '',
    'Session transcripts captured from the local Claude Code logs by `cctx`.',
    'This file is generated; edits to it will be overwritten.',
    '',
  ];

  if (
    options.preamble !== undefined &&
    options.preamble !== null &&
    options.preamble !== ''
  ) {
    lines.push(options.preamble.trim(), '');
  }

  lines.push(
    'Two things to know before reading a turn number. Tool calls and their',
    'results are stripped, because anything authored in a session lands in the',
    'working tree and is captured by the commit; what survives is the prose. And',
    'a turn is one *exchange*, coalesced from the several records a single reply',
    'occupies, so these numbers are stable only while that filter is.',
    '',
    parityStatement(sessions, carried),
    '',
  );

  if (carried.length > 0) {
    // Stated, not silent. A row nothing on this machine can regenerate is a
    // different kind of row, and a reader comparing the table against
    // `cctx list` deserves to know why the two disagree.
    lines.push(
      (carried.length === 1
        ? 'One row below was read back from a transcript already in this ' +
          'directory rather than regenerated: the session log behind it is no ' +
          'longer on this machine. '
        : `${carried.length} of the rows below were read back from transcripts ` +
          'already in this directory rather than regenerated: the session logs ' +
          'behind them are no longer on this machine. ') +
        'The transcript is the record; the log was only ever the source.',
      '',
    );
  }

  if (excluded.length > 0 && listExcluded !== 'none') {
    // Visible, never silent: a reader cannot audit an absence they cannot see.
    lines.push(
      listExcluded === 'ids'
        ? `${excluded.length} session${excluded.length === 1 ? '' : 's'} withheld by ` +
            `configuration: ${excluded.map((id) => `\`${id}\``).join(', ')}.`
        : `${excluded.length} session${excluded.length === 1 ? '' : 's'} withheld by ` +
            'configuration.',
      '',
    );
  }

  lines.push(
    'These sessions have no claude.ai URL because they never existed there.',
    '',
    '| Created | Title | Turns | Session ID |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
  );

  return lines.join('\n');
}

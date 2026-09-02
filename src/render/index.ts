import { aggregateParity, parityReport } from '../turns.js';
import type { Session } from '../types.js';

export interface RenderIndexOptions {
  /** Project-specific prose, inserted verbatim. */
  preamble?: string | null;
  /** Sessions the config withheld. */
  excluded?: string[];
  listExcluded?: 'count' | 'ids' | 'none';
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
export function parityStatement(sessions: Session[]): string {
  const totals = aggregateParity(sessions.map((s) => parityReport(s.turns)));

  if (totals.alternationBreaks === 0 && totals.sessionsNotStartingWithHuman === 0) {
    return (
      'Turns alternate without exception: odd turns are the author, even turns ' +
      'the assistant. Checked on generation, not assumed — so the speaker of ' +
      'turn N is known from N alone.'
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

  return (
    `Turns mostly alternate — odd the author, even the assistant — but there ` +
    `${parts.length === 1 ? 'is' : 'are'} ${parts.join(' and ')}. ` +
    'Read the heading rather than inferring the speaker from the number.'
  );
}

/** The generated index. Pure. */
export function renderIndex(
  sessions: Session[],
  options: RenderIndexOptions = {},
): string {
  const excluded = options.excluded ?? [];
  const listExcluded = options.listExcluded ?? 'count';

  const rows = sessions.map((session) => {
    const title = session.title.replace(/\|/g, '\\|');
    return `| ${session.created} | ${title} | ${session.turns.length} | \`${session.id}\` |`;
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
    parityStatement(sessions),
    '',
  );

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

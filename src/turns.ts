import { recordText, renderAnsweredQuestions, stripHarnessTags } from './content.js';
import type { RawRecord, SessionTurn } from './types.js';
import type { RenderContext as Ctx } from './content.js';

/**
 * True for a `user` record that is the author actually speaking.
 *
 * This is the load-bearing predicate in the package. Across the corpus this
 * was written against, 778 of 10832 `user` records are human turns — 7.2%. The
 * rest are tool results the harness feeds back and injected context. Numbering
 * those as Human turns would inflate a transcript fourteenfold and destroy the
 * property that makes citation cheap: that turns alternate, so the speaker of
 * turn N is known from N alone.
 *
 * `isSidechain` is checked here as a second, independent defense. Subagent
 * records carry it as `true` and live in a nested directory the scan does not
 * descend into (specification §4.4); this catches them if one ever arrives by
 * another route.
 */
export function isHumanTurn(record: RawRecord): boolean {
  if (record.type !== 'user') return false;
  if (record.isMeta) return false;
  if (record.isSidechain) return false;

  // An answered question widget is the author speaking, even though the record
  // is nothing but a `tool_result` and would fail the test below. The label
  // they picked — and, when they took "Other", the prose they typed — exists
  // nowhere else in the log. See specification 02, and `renderAnsweredQuestions`.
  if (renderAnsweredQuestions(record) !== null) return true;

  const content = record.message?.content;
  if (typeof content === 'string') return stripHarnessTags(content) !== '';
  if (!Array.isArray(content)) return false;

  const types = content.map((block) => block?.type);
  if (types.length > 0 && types.every((type) => type === 'tool_result')) return false;

  return stripHarnessTags(recordText(record)) !== '';
}

/**
 * Records to turns, coalescing each run of assistant records into one.
 *
 * A single reply in Claude Code is spread across many records — text, a tool
 * call, its result, more text — where a chat message is one message. The unit
 * here is the *exchange*, which is what a citation wants to name anyway.
 *
 * The cost, stated plainly: these turn numbers are stable only while this
 * filter is stable. A change to `isHumanTurn` renumbers every transcript.
 */
export function buildTurns(records: RawRecord[], context: Ctx = {}): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let assistantBuffer: string[] = [];

  const flush = () => {
    const text = assistantBuffer.join('\n\n').trim();
    if (text) turns.push({ speaker: 'Assistant', text });
    assistantBuffer = [];
  };

  for (const record of records) {
    if (record.isSidechain) continue;

    if (isHumanTurn(record)) {
      flush();
      const text = stripHarnessTags(recordText(record, context));
      if (text) turns.push({ speaker: 'Human', text });
      continue;
    }

    if (record.type === 'assistant' && !record.isMeta) {
      const text = recordText(record, context);
      if (text) assistantBuffer.push(text);
    }
  }

  flush();
  return turns;
}

/** What a session's turn sequence actually looks like, as measured. */
export interface ParityReport {
  /** Turns counted, for aggregating across sessions. */
  turns: number;
  /** False when a session opens with an assistant turn. */
  startsWithHuman: boolean;
  /**
   * Adjacent turns sharing a speaker — the places alternation genuinely
   * breaks.
   */
  alternationBreaks: number;
}

/**
 * Measures alternation rather than assuming it.
 *
 * "Odd turns are the author" is exactly the kind of plausible statement a
 * corpus gets burned by, so it is checked on generation. Across the corpus this
 * was written against it is false: 13 alternation breaks across 9 of 74
 * sessions, plus one session that opens with an assistant turn.
 *
 * **Counted as adjacent same-speaker pairs, not as index parity.** The obvious
 * implementation — compare each turn against `index % 2` — is shift-invariant
 * in the wrong direction: one break early in a long session flips every turn
 * after it, so the same 13 real breaks report as 172. That number is not wrong
 * so much as meaningless, and putting it in a generated index would be worse
 * than saying nothing.
 */
export function parityReport(turns: SessionTurn[]): ParityReport {
  let alternationBreaks = 0;
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i]?.speaker === turns[i - 1]?.speaker) alternationBreaks += 1;
  }

  return {
    turns: turns.length,
    startsWithHuman: turns.length === 0 || turns[0]?.speaker === 'Human',
    alternationBreaks,
  };
}

/** Sums per-session reports for the index. */
export function aggregateParity(reports: ParityReport[]): ParityReport & {
  sessionsNotStartingWithHuman: number;
} {
  return {
    turns: reports.reduce((n, r) => n + r.turns, 0),
    startsWithHuman: reports.every((r) => r.startsWithHuman),
    alternationBreaks: reports.reduce((n, r) => n + r.alternationBreaks, 0),
    sessionsNotStartingWithHuman: reports.filter((r) => !r.startsWithHuman).length,
  };
}

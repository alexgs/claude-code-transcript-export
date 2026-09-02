import { describe, expect, it } from 'vitest';
import {
  aggregateParity,
  buildTurns,
  isHumanTurn,
  parityReport,
} from '../src/turns.js';
import type { RawRecord } from '../src/types.js';

const human = (text: string, extra: Partial<RawRecord> = {}): RawRecord => ({
  type: 'user',
  message: { role: 'user', content: text },
  ...extra,
});

const assistant = (text: string, extra: Partial<RawRecord> = {}): RawRecord => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});

const toolResult = (): RawRecord => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', content: 'output' }] },
});

describe('isHumanTurn', () => {
  it('accepts authored prose', () => {
    expect(isHumanTurn(human('do the thing'))).toBe(true);
  });

  it('rejects a record that is entirely tool results', () => {
    expect(isHumanTurn(toolResult())).toBe(false);
  });

  it('rejects a mixed record only if nothing survives', () => {
    const mixed: RawRecord = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', content: 'x' },
          { type: 'text', text: 'and' },
        ],
      },
    };
    expect(isHumanTurn(mixed)).toBe(true);
  });

  it('rejects a slash command that strips to nothing', () => {
    expect(isHumanTurn(human('<command-name>/clear</command-name>'))).toBe(false);
  });

  it('rejects meta records', () => {
    expect(isHumanTurn(human('x', { isMeta: true }))).toBe(false);
  });

  it('rejects sidechain records, the second defense against subagent traffic', () => {
    expect(isHumanTurn(human('x', { isSidechain: true }))).toBe(false);
  });

  it('rejects assistant records', () => {
    expect(isHumanTurn(assistant('hello'))).toBe(false);
  });
});

describe('buildTurns', () => {
  it('coalesces a run of assistant records into one turn', () => {
    const turns = buildTurns([
      human('go'),
      assistant('thinking out loud'),
      toolResult(),
      assistant('and the answer'),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[1]?.speaker).toBe('Assistant');
    expect(turns[1]?.text).toBe('thinking out loud\n\nand the answer');
  });

  it('alternates across a normal exchange', () => {
    const turns = buildTurns([
      human('one'),
      assistant('two'),
      human('three'),
      assistant('four'),
    ]);
    expect(turns.map((t) => t.speaker)).toEqual([
      'Human',
      'Assistant',
      'Human',
      'Assistant',
    ]);
    expect(parityReport(turns).alternationBreaks).toBe(0);
    expect(parityReport(turns).startsWithHuman).toBe(true);
  });

  it('drops sidechain records entirely', () => {
    const turns = buildTurns([
      human('go'),
      assistant('subagent noise', { isSidechain: true }),
      assistant('real reply'),
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[1]?.text).toBe('real reply');
  });

  it('does not emit a turn for a tool-result-only user record', () => {
    const turns = buildTurns([
      human('go'),
      assistant('a'),
      toolResult(),
      assistant('b'),
    ]);
    expect(turns.filter((t) => t.speaker === 'Human')).toHaveLength(1);
  });
});

describe('parityReport', () => {
  it('notices a session that opens with an assistant turn', () => {
    const turns = buildTurns([assistant('unprompted'), human('wait')]);
    expect(parityReport(turns).startsWithHuman).toBe(false);
    // The opening turn shifts everything, but nothing actually breaks.
    expect(parityReport(turns).alternationBreaks).toBe(0);
  });

  it('counts adjacent same-speaker pairs, not index parity', () => {
    // Two human turns in a row: one real break. An index-parity metric would
    // report every turn after it as off, which is how 13 breaks became 172.
    const turns = buildTurns([
      human('one'),
      human('two'),
      assistant('three'),
      human('four'),
      assistant('five'),
    ]);
    expect(parityReport(turns).alternationBreaks).toBe(1);
  });

  it('aggregates across sessions for the index', () => {
    const clean = parityReport(buildTurns([human('a'), assistant('b')]));
    const broken = parityReport(buildTurns([assistant('a'), human('b')]));
    const total = aggregateParity([clean, broken]);
    expect(total.turns).toBe(4);
    expect(total.sessionsNotStartingWithHuman).toBe(1);
    expect(total.alternationBreaks).toBe(0);
  });
});

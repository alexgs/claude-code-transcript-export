import { describe, expect, it } from 'vitest';
import {
  frontmatterFor,
  readExtractedDate,
  renderTranscript,
} from '../src/render/transcript.js';
import { parityStatement, renderIndex } from '../src/render/index.js';
import { commitsInWindow, readCommits } from '../src/commits.js';
import type { CarriedTranscript } from '../src/carry.js';
import type { Session } from '../src/types.js';

const US = '\x1f';

const session = (over: Partial<Session> = {}): Session => ({
  id: 'abcdef01-2345-6789-abcd-ef0123456789',
  title: 'A session',
  created: '2026-08-24',
  updated: '2026-08-24',
  startedAt: '2026-08-24T21:00:00Z',
  endedAt: '2026-08-24T22:00:00Z',
  cwds: ['/work/proj'],
  turns: [
    { speaker: 'Human', text: 'ask' },
    { speaker: 'Assistant', text: 'answer' },
  ],
  images: [],
  rawMessages: 2,
  ...over,
});

describe('renderTranscript', () => {
  it('is pure: same inputs, same bytes', () => {
    const a = renderTranscript(session(), { extractedOn: '2026-09-02' });
    const b = renderTranscript(session(), { extractedOn: '2026-09-02' });
    expect(a).toBe(b);
  });

  it('numbers turns and labels speakers', () => {
    const out = renderTranscript(session(), { extractedOn: '2026-09-02' });
    expect(out).toContain('## [1] Human');
    expect(out).toContain('## [2] Assistant');
  });

  it('omits optional frontmatter fields that are absent', () => {
    const fm = frontmatterFor(session(), { extractedOn: '2026-09-02' });
    expect(fm).not.toHaveProperty('kind');
    expect(fm).not.toHaveProperty('continued_in');
    expect(fm).not.toHaveProperty('commits_in_window');
  });

  it('includes links and kind when present', () => {
    const fm = frontmatterFor(
      session({ kind: 'bg', continuedIn: 'next', continues: 'prev' }),
      { extractedOn: '2026-09-02' },
    );
    expect(fm).toMatchObject({ kind: 'bg', continued_in: 'next', continues: 'prev' });
  });

  it('renders commits as hash and subject so the hash is greppable', () => {
    const out = renderTranscript(session(), {
      extractedOn: '2026-09-02',
      commits: [
        { hash: '65bb587', at: '2026-08-24T21:30:00Z', subject: 'Initial commit' },
      ],
    });
    expect(out).toContain('65bb587 Initial commit');
  });

  it('keeps a title containing a colon readable through yaml', () => {
    const out = renderTranscript(session({ title: 'Fix: the thing' }), {
      extractedOn: '2026-09-02',
    });
    expect(out).toContain('# Fix: the thing');
    expect(out).toMatch(/title: ['"]Fix: the thing['"]/);
  });
});

describe('readExtractedDate', () => {
  it('reads the date from the frontmatter', () => {
    const doc = renderTranscript(session(), { extractedOn: '2026-09-02' });
    expect(readExtractedDate(doc)).toBe('2026-09-02');
  });

  it('ignores an extracted: line in the body', () => {
    // A transcript body is arbitrary prose and may quote frontmatter. Reading
    // the body would pick up the wrong date and defeat the whole mechanism.
    const doc = renderTranscript(
      session({ turns: [{ speaker: 'Human', text: 'extracted: 1999-01-01' }] }),
      { extractedOn: '2026-09-02' },
    );
    expect(readExtractedDate(doc)).toBe('2026-09-02');
  });

  it('returns null for a file with no frontmatter', () => {
    expect(readExtractedDate('# just a heading\n')).toBeNull();
  });
});

describe('parityStatement', () => {
  it('states alternation holds when it does', () => {
    expect(parityStatement([session()])).toContain('without exception');
  });

  it('counts adjacent same-speaker pairs, not index parity', () => {
    const broken = session({
      turns: [
        { speaker: 'Human', text: 'a' },
        { speaker: 'Human', text: 'b' },
        { speaker: 'Assistant', text: 'c' },
        { speaker: 'Human', text: 'd' },
        { speaker: 'Assistant', text: 'e' },
      ],
    });
    const statement = parityStatement([broken]);
    expect(statement).toContain('1 place');
    expect(statement).not.toContain('4 place');
    expect(statement).toContain('there is 1 place');
  });

  it('agrees with the count inside the clause, not the clause count', () => {
    const broken = session({
      turns: [
        { speaker: 'Human', text: 'a' },
        { speaker: 'Human', text: 'b' },
        { speaker: 'Human', text: 'c' },
      ],
    });
    // One clause, but it reads "2 places" — so the verb is "are".
    expect(parityStatement([broken])).toContain('there are 2 places');
  });

  it('reports a session opening with an assistant turn', () => {
    const lead = session({
      turns: [
        { speaker: 'Assistant', text: 'a' },
        { speaker: 'Human', text: 'b' },
      ],
    });
    expect(parityStatement([lead])).toContain('opening with an assistant turn');
  });
});

describe('renderIndex', () => {
  it('lists each session as a row', () => {
    const out = renderIndex([session()]);
    expect(out).toContain('| 2026-08-24 | A session | 2 |');
  });

  it('escapes a pipe in a title', () => {
    expect(renderIndex([session({ title: 'a | b' })])).toContain('a \\| b');
  });

  it('inserts a preamble verbatim', () => {
    expect(renderIndex([session()], { preamble: 'Project note.' })).toContain(
      'Project note.',
    );
  });

  it('reports withheld sessions as a count by default', () => {
    const out = renderIndex([session()], { excluded: ['x', 'y'] });
    expect(out).toContain('2 sessions withheld by configuration.');
    expect(out).not.toContain('`x`');
  });

  it('lists withheld ids when asked', () => {
    const out = renderIndex([session()], { excluded: ['x'], listExcluded: 'ids' });
    expect(out).toContain('`x`');
  });

  it('says nothing about exclusions when told not to', () => {
    const out = renderIndex([session()], { excluded: ['x'], listExcluded: 'none' });
    expect(out).not.toContain('withheld');
  });
});

describe('renderIndex with carried rows', () => {
  const carried = (over: Partial<CarriedTranscript> = {}): CarriedTranscript => ({
    filename: '2026-08-20--older--11111111.md',
    id: '11111111-2345-6789-abcd-ef0123456789',
    title: 'An older session',
    created: '2026-08-20',
    turns: 7,
    parity: { turns: 7, startsWithHuman: true, alternationBreaks: 0 },
    images: [],
    ...over,
  });

  it('sorts carried rows in among the regenerated ones', () => {
    const out = renderIndex([session()], { carried: [carried()] });
    const table = out.slice(out.indexOf('| --- |'));
    expect(table).toContain('| 2026-08-20 | An older session | 7 |');
    expect(table.indexOf('An older session')).toBeLessThan(table.indexOf('A session'));
  });

  it('says how many rows it could not regenerate', () => {
    expect(renderIndex([session()], { carried: [carried()] })).toContain(
      'One row below was read back',
    );
    expect(
      renderIndex([session()], { carried: [carried(), carried({ id: 'b' })] }),
    ).toContain('2 of the rows below were read back');
  });

  it('says nothing about carrying when there is nothing to carry', () => {
    expect(renderIndex([session()])).not.toContain('read back');
  });

  it('counts a carried transcript in the alternation statement', () => {
    const broken = carried({
      parity: { turns: 3, startsWithHuman: false, alternationBreaks: 1 },
    });
    const statement = parityStatement([session()], [broken]);
    expect(statement).toContain('1 place');
    expect(statement).toContain('opening with an assistant turn');
  });

  it('leaves an unmeasurable transcript out of the count, and says so', () => {
    const statement = parityStatement([session()], [carried({ parity: null })]);
    expect(statement).toContain('without exception');
    expect(statement).toContain(
      '1 carried-forward transcript could not be re-measured',
    );
  });
});

describe('commitsInWindow', () => {
  const commits = [
    { hash: 'aaa', at: '2026-08-24T20:00:00Z', subject: 'before' },
    { hash: 'bbb', at: '2026-08-24T21:30:00Z', subject: 'during' },
    { hash: 'ccc', at: '2026-08-24T23:00:00Z', subject: 'after' },
  ];

  it('keeps only commits inside the session window', () => {
    expect(commitsInWindow(commits, session()).map((c) => c.hash)).toEqual(['bbb']);
  });

  it('returns nothing when the session has no timestamps', () => {
    const bare = session({ startedAt: undefined, endedAt: undefined });
    expect(commitsInWindow(commits, bare)).toEqual([]);
  });
});

describe('readCommits', () => {
  it('parses the git log format', () => {
    const line = ['65bb587', '2026-08-24T21:30:00Z', 'Initial commit'].join(US);
    expect(readCommits('/x', () => line + '\n')).toEqual([
      { hash: '65bb587', at: '2026-08-24T21:30:00Z', subject: 'Initial commit' },
    ]);
  });

  it('keeps a subject containing the separator character', () => {
    const line = ['abc', '2026-08-24T21:30:00Z', 'a' + US + 'b'].join(US);
    expect(readCommits('/x', () => line + '\n')[0]?.subject).toBe('a' + US + 'b');
  });

  it('returns nothing when git fails, rather than failing the run', () => {
    expect(
      readCommits('/x', () => {
        throw new Error('not a repository');
      }),
    ).toEqual([]);
  });
});

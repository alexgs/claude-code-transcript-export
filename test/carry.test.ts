import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseTranscript,
  readImageLinks,
  readTranscripts,
  readTurnHeadings,
} from '../src/carry.js';
import { renderTranscript } from '../src/render/transcript.js';
import { tempDir } from './helpers.js';
import type { Session } from '../src/types.js';

const session = (over: Partial<Session> = {}): Session => ({
  id: 'abcdef01-2345-6789-abcd-ef0123456789',
  title: 'A session',
  created: '2026-08-24',
  updated: '2026-08-24',
  cwds: ['/work/proj'],
  turns: [
    { speaker: 'Human', text: 'ask' },
    { speaker: 'Assistant', text: 'answer' },
  ],
  images: [],
  rawMessages: 2,
  ...over,
});

const NAME = '2026-08-24--a-session--abcdef01.md';

describe('parseTranscript', () => {
  it('round-trips what the renderer wrote', () => {
    const doc = renderTranscript(session(), { extractedOn: '2026-09-02' });
    expect(parseTranscript(NAME, doc)).toEqual({
      filename: NAME,
      id: 'abcdef01-2345-6789-abcd-ef0123456789',
      title: 'A session',
      created: '2026-08-24',
      turns: 2,
      parity: { turns: 2, startsWithHuman: true, alternationBreaks: 0 },
      images: [],
    });
  });

  it('re-measures alternation from the headings', () => {
    const doc = renderTranscript(
      session({
        turns: [
          { speaker: 'Assistant', text: 'a' },
          { speaker: 'Assistant', text: 'b' },
          { speaker: 'Human', text: 'c' },
        ],
      }),
      { extractedOn: '2026-09-02' },
    );
    expect(parseTranscript(NAME, doc)?.parity).toEqual({
      turns: 3,
      startsWithHuman: false,
      alternationBreaks: 1,
    });
  });

  it('reads a title that yaml had to quote', () => {
    const doc = renderTranscript(session({ title: 'Fix: the thing' }), {
      extractedOn: '2026-09-02',
    });
    expect(parseTranscript(NAME, doc)?.title).toBe('Fix: the thing');
  });

  it('refuses to measure a body that quotes a turn heading', () => {
    // The failure this guards is specific to this repo's own transcripts: a
    // session about the tool discusses the headings the tool writes.
    const doc = renderTranscript(
      session({
        turns: [
          {
            speaker: 'Human',
            text: 'the renderer emits\n\n## [9] Assistant\n\nlike so',
          },
          { speaker: 'Assistant', text: 'it does' },
        ],
      }),
      { extractedOn: '2026-09-02' },
    );
    const parsed = parseTranscript(NAME, doc);
    // The row survives — the count comes from the frontmatter — but alternation
    // is reported as unmeasured rather than guessed at.
    expect(parsed?.turns).toBe(2);
    expect(parsed?.parity).toBeNull();
  });

  it('collects linked images by name', () => {
    const doc = renderTranscript(
      session({
        turns: [
          { speaker: 'Human', text: '![pasted image](images/abcdef01-11111111.png)' },
        ],
      }),
      { extractedOn: '2026-09-02' },
    );
    expect(parseTranscript(NAME, doc)?.images).toEqual(['abcdef01-11111111.png']);
  });

  it('is null for a file with no frontmatter', () => {
    expect(parseTranscript(NAME, '# Just prose\n')).toBeNull();
  });

  it('is null when the frontmatter is unparseable, rather than throwing', () => {
    expect(
      parseTranscript(NAME, '---\ntitle: "unterminated\n---\n\nbody\n'),
    ).toBeNull();
  });

  it('is null when an identifying field is missing', () => {
    const doc = '---\ntitle: A session\ncreated: 2026-08-24\n---\n\nbody\n';
    expect(parseTranscript(NAME, doc)).toBeNull();
  });
});

describe('readTurnHeadings', () => {
  it('rejects headings that do not number themselves in sequence', () => {
    expect(readTurnHeadings('## [1] Human\n\n## [3] Assistant\n')).toBeNull();
  });

  it('rejects a count the frontmatter disagrees with', () => {
    expect(readTurnHeadings('## [1] Human\n', 2)).toBeNull();
  });

  it('accepts an empty transcript declaring no turns', () => {
    expect(readTurnHeadings('nothing here\n', 0)).toEqual([]);
  });
});

describe('readImageLinks', () => {
  it('takes the basename, whatever directory the link names', () => {
    expect(readImageLinks('![x](images/a.png) ![y](../assets/b.jpg)')).toEqual([
      'a.png',
      'b.jpg',
    ]);
  });

  it('ignores remote images, which are nothing this tool wrote', () => {
    expect(readImageLinks('![x](https://example.com/a.png)')).toEqual([]);
  });

  it('lists each name once', () => {
    expect(readImageLinks('![x](images/a.png)\n![x](images/a.png)')).toEqual(['a.png']);
  });
});

describe('readTranscripts', () => {
  it('reads transcripts and nothing else in the directory', () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, NAME),
      renderTranscript(session(), { extractedOn: '2026-09-02' }),
    );
    writeFileSync(join(dir, 'index.md'), '# Claude Code sessions\n');
    writeFileSync(join(dir, 'notes.md'), '---\nsession_id: x\n---\n');
    mkdirSync(join(dir, 'images'));

    expect(readTranscripts(dir).map((t) => t.filename)).toEqual([NAME]);
  });

  it('is empty for a directory that does not exist yet', () => {
    expect(readTranscripts(join(tempDir(), 'nope'))).toEqual([]);
  });
});

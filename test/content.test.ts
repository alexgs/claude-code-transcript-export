import { describe, expect, it } from 'vitest';
import {
  fence,
  recordText,
  renderAnsweredQuestions,
  renderBlock,
  slugify,
  stripHarnessTags,
} from '../src/content.js';
import type { RawBlock, RawRecord, SessionImage } from '../src/types.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const image = (data: Buffer, mediaType = 'image/png'): RawBlock => ({
  type: 'image',
  source: { type: 'base64', media_type: mediaType, data: data.toString('base64') },
});

describe('stripHarnessTags', () => {
  it('removes a paired tag with its contents', () => {
    expect(stripHarnessTags('a<system-reminder>noise</system-reminder>b')).toBe('ab');
  });

  it('strips the command name too, so /clear is not a human turn', () => {
    const slash = '<command-name>/clear</command-name><command-args></command-args>';
    expect(stripHarnessTags(slash)).toBe('');
  });

  it('leaves ordinary prose alone', () => {
    expect(stripHarnessTags('  real words  ')).toBe('real words');
  });
});

describe('fence', () => {
  it('outgrows a fence contained in the payload', () => {
    const rendered = fence('```\nnested\n```', 'x');
    expect(rendered.startsWith('````x')).toBe(true);
  });
});

describe('slugify', () => {
  it('collapses punctuation and truncates', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('x'.repeat(80))).toHaveLength(60);
  });

  it('never returns empty', () => {
    expect(slugify('!!!')).toBe('untitled');
  });
});

describe('renderBlock', () => {
  it('drops thinking by default', () => {
    expect(renderBlock({ type: 'thinking', thinking: 'hm' })).toBeNull();
  });

  it('drops tool traffic by default', () => {
    expect(renderBlock({ type: 'tool_use', name: 'Bash' })).toBeNull();
    expect(renderBlock({ type: 'tool_result', name: 'Bash' })).toBeNull();
  });

  it('keeps tool traffic when policy says so', () => {
    const policy = { tools: 'keep', thinking: 'drop', images: 'extract' } as const;
    expect(renderBlock({ type: 'tool_use', name: 'Bash' }, { policy })).toContain(
      'tool_use:Bash',
    );
  });

  it('marks an unknown block type rather than dropping it silently', () => {
    expect(renderBlock({ type: 'video' })).toBe('> [unhandled block type: video]');
  });
});

describe('renderBlock, images', () => {
  it('names an extracted image by content hash', () => {
    const collected: SessionImage[] = [];
    const out = renderBlock(image(PNG), { sessionId8: 'abcd1234', collected });
    expect(out).toMatch(/^!\[pasted image\]\(images\/abcd1234-[0-9a-f]{8}\.png\)$/);
    expect(collected).toHaveLength(1);
    expect(collected[0]?.data).toEqual(PNG);
  });

  it('gives identical bytes an identical filename, so reruns do not duplicate', () => {
    const a: SessionImage[] = [];
    const b: SessionImage[] = [];
    const first = renderBlock(image(PNG), { sessionId8: 'abcd1234', collected: a });
    const second = renderBlock(image(PNG), { sessionId8: 'abcd1234', collected: b });
    expect(first).toBe(second);
  });

  it('collects the same image once within a session', () => {
    const collected: SessionImage[] = [];
    renderBlock(image(PNG), { sessionId8: 'abcd1234', collected });
    renderBlock(image(PNG), { sessionId8: 'abcd1234', collected });
    expect(collected).toHaveLength(1);
  });

  it('falls back to a marker for an unrecognized media type', () => {
    const collected: SessionImage[] = [];
    const out = renderBlock(image(PNG, 'image/tiff'), { collected });
    expect(out).toContain('[image: image/tiff');
    expect(collected).toHaveLength(0);
  });

  it('emits no file under the marker policy', () => {
    const collected: SessionImage[] = [];
    const policy = { tools: 'strip', thinking: 'drop', images: 'marker' } as const;
    const out = renderBlock(image(PNG), { policy, collected });
    expect(out).toMatch(/^> \[image: image\/png, \d+ B\]$/);
    expect(collected).toHaveLength(0);
  });
});

describe('recordText', () => {
  it('reads a flat string body', () => {
    expect(recordText({ message: { content: '  hi  ' } })).toBe('hi');
  });

  it('joins surviving blocks and omits dropped ones', () => {
    const record = {
      message: {
        content: [
          { type: 'text', text: 'one' },
          { type: 'thinking', thinking: 'hidden' },
          { type: 'text', text: 'two' },
        ],
      },
    };
    expect(recordText(record)).toBe('one\n\ntwo');
  });
});

/**
 * The widget's `toolUseResult`, as observed. `questions` is required for
 * recognition but nothing is rendered out of it: the question text the
 * transcript prints is the key of `answers`.
 */
const answered = (
  answers: Record<string, unknown>,
  annotations: Record<string, unknown> = {},
): RawRecord => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', content: 'Your questions have been answered.' }],
  },
  toolUseResult: {
    questions: Object.keys(answers).map((question) => ({ question, options: [] })),
    answers,
    annotations,
  },
});

describe('renderAnsweredQuestions', () => {
  it('renders the question and the option the author picked', () => {
    const out = renderAnsweredQuestions(answered({ 'Which way?': 'The narrow one' }));
    expect(out).toBe('**Which way?**\n\nThe narrow one');
  });

  it('keeps free text the author typed into "Other"', () => {
    // The case the whole feature is for: this prose exists nowhere else in
    // the log, and the option labels do not contain it.
    const prose = "Let's keep it manual — that has worked fine so far.";
    expect(renderAnsweredQuestions(answered({ 'How?': prose }))).toContain(prose);
  });

  it('quotes notes typed alongside a selection', () => {
    const out = renderAnsweredQuestions(
      answered(
        { 'How?': 'Prefix them' },
        { 'How?': { notes: 'Use the short id.\n\nAnd rename the old ones.' } },
      ),
    );
    expect(out).toBe(
      '**How?**\n\nPrefix them\n\n> Use the short id.\n>\n> And rename the old ones.',
    );
  });

  it('joins a multi-select answer that arrived as a list', () => {
    const out = renderAnsweredQuestions(answered({ 'Which?': ['a', 'b'] }));
    expect(out).toBe('**Which?**\n\na, b');
  });

  it('collapses a newline inside a question, which would break the emphasis', () => {
    const out = renderAnsweredQuestions(answered({ 'One line\nand another': 'yes' }));
    expect(out).toBe('**One line and another**\n\nyes');
  });

  it('returns null for a dismissed widget, whose result is an error string', () => {
    const dismissed: RawRecord = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', content: 'rejected' }],
      },
      toolUseResult: "Error: The user doesn't want to proceed with this tool use.",
    };
    expect(renderAnsweredQuestions(dismissed)).toBeNull();
  });

  it('returns null for an ordinary tool result', () => {
    const record: RawRecord = {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'files' }] },
      toolUseResult: { stdout: 'files', stderr: '' },
    };
    expect(renderAnsweredQuestions(record)).toBeNull();
  });

  it('returns null when the widget carries no answers', () => {
    expect(renderAnsweredQuestions(answered({}))).toBeNull();
  });
});

describe('recordText, answered questions', () => {
  it('survives the default tools: strip policy', () => {
    expect(recordText(answered({ 'Which way?': 'The narrow one' }))).toBe(
      '**Which way?**\n\nThe narrow one',
    );
  });

  it('replaces the raw tool_result rather than repeating it under tools: keep', () => {
    const policy = { tools: 'keep', thinking: 'drop', images: 'extract' } as const;
    const out = recordText(answered({ 'Which way?': 'The narrow one' }), { policy });
    expect(out).toBe('**Which way?**\n\nThe narrow one');
    expect(out).not.toContain('tool_result');
  });
});

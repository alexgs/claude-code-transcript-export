import { describe, expect, it } from 'vitest';
import {
  fence,
  recordText,
  renderBlock,
  slugify,
  stripHarnessTags,
} from '../src/content.js';
import type { RawBlock, SessionImage } from '../src/types.js';

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

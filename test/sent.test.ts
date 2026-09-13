import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../src/config.js';
import { extract } from '../src/extract.js';
import { ImageReads, renderSentFiles, sentFiles } from '../src/sent.js';
import { buildTurns } from '../src/turns.js';
import type { RawRecord, SentFileSources, SessionImage } from '../src/types.js';
import { assistantRecord, tempDir, userRecord, writeLog } from './helpers.js';

const PATH = '/tmp/scratch/chart.png';
const UUID = 'c0ffee01-aaaa-4bbb-8ccc-dddddddddddd';

const bytes = (fill: number, length: number) => Buffer.alloc(length, fill);

/** An assistant `Read` of `path`, and the result carrying the image. */
const read = (id: string, path: string, data: Buffer, originalSize?: number) =>
  [
    {
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path } }],
      },
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: id,
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: data.toString('base64'),
                },
              },
            ],
          },
        ],
      },
      toolUseResult: {
        type: 'image',
        file: { type: 'image/png', originalSize: originalSize ?? data.byteLength },
      },
    },
  ] satisfies RawRecord[];

interface Attachment {
  path?: string;
  size?: number;
  isImage?: boolean;
  media_type?: string;
  file_uuid?: string;
}

/** A `SendUserFile` result record. */
const sent = (
  attachments: Attachment[],
  caption = 'What the image shows.',
): RawRecord => ({
  type: 'user',
  message: {
    role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'toolu_send', content: 'delivered' }],
  },
  toolUseResult: {
    caption,
    attachments: attachments.map((a) => ({
      path: PATH,
      size: 16,
      isImage: true,
      media_type: 'image/png',
      file_uuid: UUID,
      ...a,
    })),
  },
});

/** Renders `records` into one session's turns, returning what was collected. */
function render(records: RawRecord[], sources?: SentFileSources) {
  const collected: SessionImage[] = [];
  const turns = buildTurns(records, { sessionId8: 'abcdef01', collected, sources });
  return { turns, collected };
}

describe('sentFiles', () => {
  it('reads the caption and every attachment', () => {
    const files = sentFiles(sent([{}, { path: '/work/notes.svg', isImage: false }]));
    expect(files?.caption).toBe('What the image shows.');
    expect(files?.attachments.map((a) => [a.path, a.isImage])).toEqual([
      [PATH, true],
      ['/work/notes.svg', false],
    ]);
  });

  it('returns null for a failed send, whose result is an error string', () => {
    const failed: RawRecord = { type: 'user', toolUseResult: 'Error: no such file' };
    expect(sentFiles(failed)).toBeNull();
  });

  it('returns null for an ordinary tool result', () => {
    expect(sentFiles({ type: 'user', toolUseResult: { stdout: 'ok' } })).toBeNull();
  });
});

describe('renderSentFiles', () => {
  it('uses a Read copy from the log, named by the delivery rather than the bytes', () => {
    const { turns, collected } = render([
      ...read('r1', PATH, bytes(1, 16)),
      sent([{}]),
    ]);

    expect(turns).toEqual([
      {
        speaker: 'Assistant',
        text: [
          `Sent \`${PATH}\``,
          '![chart.png](images/abcdef01-c0ffee01.png)',
          'What the image shows.',
        ].join('\n\n'),
      },
    ]);
    expect(collected).toEqual([
      { filename: 'abcdef01-c0ffee01.png', mediaType: 'image/png', data: bytes(1, 16) },
    ]);
  });

  it('joins the assistant turn it belongs to instead of splitting it', () => {
    const { turns } = render([
      userRecord('make a chart'),
      assistantRecord('Here it is.'),
      sent([{}]),
      assistantRecord('Anything else?'),
    ]);
    expect(turns.map((t) => t.speaker)).toEqual(['Human', 'Assistant']);
    expect(turns[1]?.text).toMatch(/^Here it is\.\n\nSent .*\n\nAnything else\?$/s);
  });

  it('skips a Read of an earlier version of the file, which was since overwritten', () => {
    const { turns, collected } = render([
      ...read('r1', PATH, bytes(1, 99)),
      sent([{}]),
    ]);
    expect(turns[0]?.text).toContain(
      '> [image: image/png, 16 B, not in the log or on disk]',
    );
    expect(collected).toEqual([]);
  });

  it('ignores a Read that came after the send', () => {
    const { collected } = render([sent([{}]), ...read('r1', PATH, bytes(1, 16))]);
    expect(collected).toEqual([]);
  });

  it('copies the original from disk when the log lacks it and the size still matches', () => {
    const asked: [string, number][] = [];
    const sources: SentFileSources = {
      readExtracted: () => undefined,
      readOriginal: (path, size) => {
        asked.push([path, size]);
        return bytes(2, size);
      },
    };
    const { collected } = render([sent([{}])], sources);
    expect(asked).toEqual([[PATH, 16]]);
    expect(collected[0]?.data).toEqual(bytes(2, 16));
  });

  it('prefers a copy a previous run extracted over the original on disk', () => {
    const sources: SentFileSources = {
      readExtracted: (filename) =>
        filename === 'abcdef01-c0ffee01.png' ? bytes(3, 16) : undefined,
      readOriginal: () => bytes(4, 16),
    };
    const { turns, collected } = render([sent([{}])], sources);
    expect(turns[0]?.text).toContain('![chart.png](images/abcdef01-c0ffee01.png)');
    expect(collected[0]?.data).toEqual(bytes(3, 16));
  });

  it('falls back to a downscaled Read copy only when nothing better exists', () => {
    const records = [...read('r1', PATH, bytes(5, 8), 16), sent([{}])];

    expect(render(records).collected[0]?.data).toEqual(bytes(5, 8));

    const onDisk: SentFileSources = {
      readExtracted: () => undefined,
      readOriginal: (_path, size) => bytes(6, size),
    };
    expect(render(records, onDisk).collected[0]?.data).toEqual(bytes(6, 16));
  });

  it('names an image by content hash when the send recorded no uuid', () => {
    const { collected } = render([
      ...read('r1', PATH, bytes(1, 16)),
      sent([{ file_uuid: undefined }]),
    ]);
    expect(collected[0]?.filename).toMatch(/^abcdef01-[0-9a-f]{8}\.png$/);
  });

  it('lists a file that is not an image by path alone', () => {
    const { turns } = render([sent([{ path: '/work/notes.svg', isImage: false }], '')]);
    expect(turns[0]?.text).toBe('Sent `/work/notes.svg`');
  });

  it('writes nothing and reads nothing under the marker policy', () => {
    const collected: SessionImage[] = [];
    const sources: SentFileSources = {
      readExtracted: () => {
        throw new Error('read under marker policy');
      },
      readOriginal: () => {
        throw new Error('read under marker policy');
      },
    };
    const text = renderSentFiles(sent([{}]), new ImageReads(), {
      policy: { tools: 'strip', thinking: 'drop', images: 'marker' },
      collected,
      sources,
    });
    expect(text).toContain('> [image: image/png, 16 B]');
    expect(collected).toEqual([]);
  });

  it('survives tools: strip, and does not render a turn of its own under keep', () => {
    const records = [assistantRecord('Sending.'), sent([{}])];
    const keep = buildTurns(records, {
      policy: { tools: 'keep', thinking: 'drop', images: 'extract' },
    });
    expect(keep).toHaveLength(1);
    expect(keep[0]?.text).toContain('What the image shows.');
  });
});

describe('extract, sent images', () => {
  const SESSION_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

  function setup() {
    const logRoot = tempDir('cctx-logs-');
    const root = tempDir('cctx-proj-');
    const scratch = tempDir('cctx-scratch-');
    const original = join(scratch, 'render.png');
    writeFileSync(original, bytes(7, 32));

    const at = (second: number) => ({
      sessionId: SESSION_ID,
      cwd: root,
      timestamp: `2026-08-24T21:13:${String(second).padStart(2, '0')}Z`,
    });

    writeLog(join(logRoot, 'encoded', `${SESSION_ID}.jsonl`), [
      { type: 'ai-title', aiTitle: 'Rendering things' },
      userRecord('render it', at(0)),
      assistantRecord('Rendered.', at(1)),
      { ...sent([{ path: original, size: 32 }], 'The render.'), ...at(2) },
    ]);

    const config = { ...DEFAULT_CONFIG, out: 'transcripts' };
    const run = () =>
      extract({ root, logRoot, config, today: '2026-09-13', commits: [] });
    return { root, original, run };
  }

  it('copies the original the log never held', () => {
    const { root, run } = setup();
    const summary = run();

    const image = join(root, 'transcripts', 'images', 'abcdef01-c0ffee01.png');
    expect(summary.imagesWritten).toEqual(['abcdef01-c0ffee01.png']);
    expect(readFileSync(image)).toEqual(bytes(7, 32));
  });

  it('keeps the copy, the link, and the transcript once the original is gone', () => {
    const { root, original, run } = setup();
    run();
    const image = join(root, 'transcripts', 'images', 'abcdef01-c0ffee01.png');

    rmSync(original);
    const summary = run();

    expect(summary.written).toBe(0);
    expect(summary.imagesWritten).toEqual([]);
    expect(summary.orphanImages).toEqual([]);
    expect(existsSync(image)).toBe(true);
  });

  it('does not replace a captured image with a later file at the same path', () => {
    const { root, original, run } = setup();
    run();
    writeFileSync(original, bytes(8, 32));
    run();

    const image = join(root, 'transcripts', 'images', 'abcdef01-c0ffee01.png');
    expect(readFileSync(image)).toEqual(bytes(7, 32));
  });
});

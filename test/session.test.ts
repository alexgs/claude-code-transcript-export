import { describe, expect, it } from 'vitest';
import { slugify } from '../src/content.js';
import {
  fallbackIdFor,
  linkContinuations,
  readSession,
  sessionFilename,
} from '../src/session.js';
import { assistantRecord, userRecord } from './helpers.js';
import type { RawRecord, Session } from '../src/types.js';

const at = (iso: string) => ({ timestamp: iso });

describe('readSession', () => {
  const records: RawRecord[] = [
    { type: 'mode', mode: 'normal', sessionId: 'abcdef01-2345-6789-abcd-ef0123456789' },
    { type: 'ai-title', aiTitle: 'Model name' },
    { type: 'custom-title', customTitle: 'My name for it' },
    userRecord('first', { ...at('2026-08-24T21:13:00Z'), cwd: '/work/proj' }),
    assistantRecord('reply', at('2026-08-24T21:14:00Z')),
    userRecord('second', at('2026-08-25T00:20:00Z')),
    assistantRecord('done', at('2026-08-25T00:21:00Z')),
  ];

  it('prefers the custom title', () => {
    expect(readSession(records).title).toBe('My name for it');
  });

  it('takes its id from the records', () => {
    expect(readSession(records).id).toBe('abcdef01-2345-6789-abcd-ef0123456789');
  });

  it('keeps full-precision timestamps alongside the local dates', () => {
    const session = readSession(records);
    expect(session.startedAt).toBe('2026-08-24T21:13:00Z');
    expect(session.endedAt).toBe('2026-08-25T00:21:00Z');
  });

  it('counts conversational records separately from turns', () => {
    const session = readSession(records);
    expect(session.rawMessages).toBe(4);
    expect(session.turns).toHaveLength(4);
  });

  it('collects working directories including relocations', () => {
    const session = readSession([
      ...records,
      { type: 'relocated', relocatedCwd: '/work/proj/.claude/worktrees/w' },
    ]);
    expect(session.cwds).toEqual(['/work/proj', '/work/proj/.claude/worktrees/w']);
  });

  it('reads sessionKind off ordinary records', () => {
    const session = readSession([
      userRecord('x', {
        sessionId: 's',
        sessionKind: 'bg',
        ...at('2026-01-01T00:00:00Z'),
      }),
    ]);
    expect(session.kind).toBe('bg');
  });

  it('records a continued-in pointer', () => {
    const session = readSession([
      ...records,
      { type: 'continued-in', continuedInSessionId: 'next-session-id' },
    ]);
    expect(session.continuedIn).toBe('next-session-id');
  });

  it('collects images for the writer', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const session = readSession([
      {
        type: 'user',
        sessionId: 'abcdef0123',
        timestamp: '2026-01-01T00:00:00Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png },
            },
          ],
        },
      },
    ]);
    expect(session.images).toHaveLength(1);
    expect(session.images[0]?.filename).toMatch(/^abcdef01-[0-9a-f]{8}\.png$/);
    expect(session.turns[0]?.text).toContain('images/abcdef01-');
  });

  it('falls back to a supplied id when no record carries one', () => {
    expect(readSession([userRecord('x')], { fallbackId: 'from-filename' }).id).toBe(
      'from-filename',
    );
  });
});

describe('linkContinuations', () => {
  it('fills in the reverse link across the run', () => {
    const sessions = [
      { id: 'a', continuedIn: 'b' },
      { id: 'b' },
    ] as unknown as Session[];
    linkContinuations(sessions);
    expect(sessions[1]?.continues).toBe('a');
  });

  it('leaves a dangling pointer alone when the target is not captured', () => {
    const sessions = [{ id: 'a', continuedIn: 'gone' }] as unknown as Session[];
    expect(() => linkContinuations(sessions)).not.toThrow();
    expect(sessions[0]?.continues).toBeUndefined();
  });
});

describe('sessionFilename', () => {
  it('is date, slug and eight characters of the id', () => {
    const session = {
      id: 'abcdef01-2345',
      title: 'Consolidating the Two Sites',
      created: '2026-08-29',
    } as Session;
    expect(sessionFilename(session, slugify)).toBe(
      '2026-08-29--consolidating-the-two-sites--abcdef01.md',
    );
  });
});

describe('fallbackIdFor', () => {
  it('strips the extension', () => {
    expect(fallbackIdFor('/a/b/c-d-e.jsonl')).toBe('c-d-e');
  });
});

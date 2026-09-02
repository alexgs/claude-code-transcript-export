import { describe, expect, it } from 'vitest';
import { resolveTitle, toLocalDate } from '../src/titles.js';
import type { RawRecord } from '../src/types.js';

describe('resolveTitle', () => {
  it('prefers a custom title even when an ai-title comes later', () => {
    const records: RawRecord[] = [
      { type: 'custom-title', customTitle: 'What I called it' },
      { type: 'ai-title', aiTitle: 'What the model called it' },
    ];
    expect(resolveTitle(records)).toBe('What I called it');
  });

  it('takes the last of several titles of the same kind', () => {
    const records: RawRecord[] = [
      { type: 'ai-title', aiTitle: 'first guess' },
      { type: 'ai-title', aiTitle: 'renamed later' },
    ];
    expect(resolveTitle(records)).toBe('renamed later');
  });

  it('falls back to agent-name when nothing else is present', () => {
    expect(resolveTitle([{ type: 'agent-name', agentName: 'nightly job' }])).toBe(
      'nightly job',
    );
  });

  it('falls back to a placeholder when a session was never named', () => {
    expect(resolveTitle([{ type: 'user' }])).toBe('Untitled session');
  });

  it('ignores an empty title', () => {
    const records: RawRecord[] = [
      { type: 'ai-title', aiTitle: 'real' },
      { type: 'ai-title', aiTitle: '   ' },
    ];
    expect(resolveTitle(records)).toBe('real');
  });
});

describe('toLocalDate', () => {
  it('renders in local time, not UTC', () => {
    // Construct a timestamp that falls on a different date locally than in UTC
    // whenever the machine is behind UTC, which is the case this exists for.
    const local = new Date(2026, 7, 24, 17, 13);
    expect(toLocalDate(local.toISOString())).toBe('2026-08-24');
  });

  it('reports unknown for a missing or unparseable stamp', () => {
    expect(toLocalDate(undefined)).toBe('unknown');
    expect(toLocalDate('not a date')).toBe('unknown');
  });
});

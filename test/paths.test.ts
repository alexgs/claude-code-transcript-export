import { describe, expect, it } from 'vitest';
import { defaultLogRoot, encodeProjectDir, isWithin } from '../src/paths.js';

describe('defaultLogRoot', () => {
  it('takes home as a parameter so tests never touch the real one', () => {
    expect(defaultLogRoot('/tmp/fake-home')).toBe('/tmp/fake-home/.claude/projects');
  });
});

describe('encodeProjectDir', () => {
  it('replaces separators with hyphens', () => {
    expect(encodeProjectDir('/Users/a/p')).toBe('-Users-a-p');
  });

  it('ignores a trailing separator', () => {
    expect(encodeProjectDir('/Users/a/p/')).toBe('-Users-a-p');
  });

  it('is lossy, which is why it is never used for decoding', () => {
    // Both encode identically. Project membership reads `cwd` instead.
    expect(encodeProjectDir('/Users/a/b-c')).toBe(encodeProjectDir('/Users/a/b/c'));
  });
});

describe('isWithin', () => {
  it('accepts the root itself', () => {
    expect(isWithin('/Users/a/p', '/Users/a/p')).toBe(true);
  });

  it('accepts a subdirectory launch', () => {
    expect(isWithin('/Users/a/p', '/Users/a/p/scripts')).toBe(true);
  });

  it('accepts a worktree beneath the project', () => {
    expect(isWithin('/Users/a/p', '/Users/a/p/.claude/worktrees/spike')).toBe(true);
  });

  it('rejects a sibling whose name shares a prefix', () => {
    expect(isWithin('/Users/a/p', '/Users/a/proto')).toBe(false);
  });

  it('rejects a parent', () => {
    expect(isWithin('/Users/a/p', '/Users/a')).toBe(false);
  });
});

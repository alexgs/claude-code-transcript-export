import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  UsageError,
  findConfig,
  loadConfig,
  mergeConfig,
  parseConfigFile,
} from '../src/config.js';
import { tempDir } from './helpers.js';

describe('findConfig', () => {
  it('walks up to find a config several directories above', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: x\n');
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(findConfig(deep)).toBe(join(root, '.claude-export.yaml'));
  });

  it('prefers yaml over json in the same directory', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: y\n');
    writeFileSync(join(root, '.claude-export.json'), '{"out":"j"}');
    expect(findConfig(root)?.endsWith('.yaml')).toBe(true);
  });

  it('returns null rather than guessing when there is no config', () => {
    expect(findConfig(tempDir())).toBeNull();
  });
});

describe('loadConfig', () => {
  it('reports the config directory as the project root', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: transcripts\n');
    const deep = join(root, 'src', 'nested');
    mkdirSync(deep, { recursive: true });
    const resolved = loadConfig(deep);
    expect(resolved?.root).toBe(root);
    expect(resolved?.config.out).toBe('transcripts');
  });

  it('uses defaults and no config path for a --project override', () => {
    const resolved = loadConfig('/anywhere', '/work/proj');
    expect(resolved?.configPath).toBeNull();
    expect(resolved?.root).toBe('/work/proj');
    expect(resolved?.config).toEqual(DEFAULT_CONFIG);
  });
});

describe('mergeConfig', () => {
  it('defaults to capturing active sessions', () => {
    expect(mergeConfig({}).skipActive).toBe(false);
  });

  it('names an unknown key rather than ignoring it', () => {
    // A typo in `exclude` that quietly does nothing is how a session you meant
    // to withhold ends up committed.
    expect(() => mergeConfig({ excludes: [] })).toThrow(
      /unknown config key `excludes`/,
    );
  });

  it('names an unknown nested key', () => {
    expect(() => mergeConfig({ index: { preambles: 'x' } })).toThrow(
      /unknown config key `index.preambles`/,
    );
  });

  it('rejects a bad enum with the allowed values', () => {
    expect(() => mergeConfig({ tools: 'summarize' })).toThrow(/strip \| keep/);
  });

  it('rejects a non-list exclude', () => {
    expect(() => mergeConfig({ exclude: 'abc' })).toThrow(UsageError);
  });

  it('merges index options without dropping the others', () => {
    const config = mergeConfig({ index: { preamble: 'hello' } });
    expect(config.index.preamble).toBe('hello');
    expect(config.index.enabled).toBe(true);
    expect(config.index.listExcluded).toBe('count');
  });

  it('does not mutate the shared defaults', () => {
    mergeConfig({ index: { enabled: false } });
    expect(DEFAULT_CONFIG.index.enabled).toBe(true);
  });
});

describe('parseConfigFile', () => {
  it('reads yaml', () => {
    expect(
      parseConfigFile('c.yaml', 'out: docs/s\nexclude:\n  - abc\n').exclude,
    ).toEqual(['abc']);
  });

  it('reads json', () => {
    expect(parseConfigFile('c.json', '{"out":"d"}').out).toBe('d');
  });

  it('reports a syntax error as a usage error', () => {
    expect(() => parseConfigFile('c.json', '{oops')).toThrow(UsageError);
  });
});

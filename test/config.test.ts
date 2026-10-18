import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_CONFIG,
  UsageError,
  configNameWarnings,
  findConfig,
  loadConfig,
  loadConfigFile,
  mergeConfig,
  parseConfigFile,
} from '../src/config.js';
import { tempDir } from './helpers.js';

describe('findConfig', () => {
  it('walks up to find a config several directories above', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: x\n');
    const deep = join(root, 'a', 'b', 'c');
    mkdirSync(deep, { recursive: true });
    expect(findConfig(deep)).toBe(join(root, '.cctx.yaml'));
  });

  it('prefers yaml over json in the same directory', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: y\n');
    writeFileSync(join(root, '.cctx.json'), '{"out":"j"}');
    expect(findConfig(root)?.endsWith('.yaml')).toBe(true);
  });

  it('returns null rather than guessing when there is no config', () => {
    expect(findConfig(tempDir())).toBeNull();
  });

  it('still finds a config under its legacy name', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.json'), '{"out":"j"}');
    expect(findConfig(root)).toBe(join(root, '.claude-export.json'));
  });

  it('prefers the current name over a legacy one in the same directory', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: old\n');
    writeFileSync(join(root, '.cctx.json'), '{"out":"new"}');
    expect(findConfig(root)).toBe(join(root, '.cctx.json'));
  });

  it('lets a nearer legacy config beat a farther current one', () => {
    // The project root must not move because a parent was renamed first.
    const parent = tempDir();
    const nested = join(parent, 'nested');
    mkdirSync(nested);
    writeFileSync(join(parent, '.cctx.yaml'), 'out: parent\n');
    writeFileSync(join(nested, '.claude-export.yaml'), 'out: nested\n');
    expect(findConfig(nested)).toBe(join(nested, '.claude-export.yaml'));
  });
});

describe('configNameWarnings', () => {
  it('is silent for a current name with nothing beside it', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: x\n');
    expect(configNameWarnings(join(root, '.cctx.yaml'))).toEqual([]);
  });

  it('tells a legacy config the name to rename it to, matching its format', () => {
    const root = tempDir();
    const legacy = join(root, '.claude-export.json');
    writeFileSync(legacy, '{}');
    const [warning] = configNameWarnings(legacy);
    expect(warning).toContain(`mv ${legacy} ${join(root, '.cctx.json')}`);
  });

  it('names a legacy file that the current one is shadowing', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: x\n');
    writeFileSync(join(root, '.claude-export.yaml'), 'out: y\n');
    const warnings = configNameWarnings(join(root, '.cctx.yaml'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${join(root, '.claude-export.yaml')} is ignored`);
  });
});

describe('loadConfig', () => {
  it('reports the config directory as the project root', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: transcripts\n');
    const deep = join(root, 'src', 'nested');
    mkdirSync(deep, { recursive: true });
    const resolved = loadConfig(deep);
    expect(resolved?.root).toBe(root);
    expect(resolved?.config.out).toBe('transcripts');
    expect(resolved?.warnings).toEqual([]);
  });

  it('loads a legacy config and says to rename it', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: legacy\n');
    const resolved = loadConfig(root);
    expect(resolved?.config.out).toBe('legacy');
    expect(resolved?.warnings[0]).toContain('old config name');
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

describe('loadConfigFile', () => {
  it('reads the file named, not a standard name beside it', () => {
    const root = tempDir();
    writeFileSync(join(root, '.cctx.yaml'), 'out: standard\n');
    writeFileSync(join(root, 'other.yaml'), 'out: other\n');
    const resolved = loadConfigFile(join(root, 'other.yaml'));
    expect(resolved.config.out).toBe('other');
    expect(resolved.configPath).toBe(join(root, 'other.yaml'));
    expect(resolved.root).toBe(root);
  });

  it('reads a file with no standard config anywhere above it', () => {
    const root = tempDir();
    writeFileSync(join(root, 'settings.json'), '{"out":"j"}');
    expect(loadConfigFile(join(root, 'settings.json')).config.out).toBe('j');
  });

  it('warns about a legacy name, but not about a legacy file beside a chosen one', () => {
    const root = tempDir();
    writeFileSync(join(root, '.claude-export.yaml'), 'out: old\n');
    writeFileSync(join(root, 'chosen.yaml'), 'out: chosen\n');
    expect(loadConfigFile(join(root, '.claude-export.yaml')).warnings).toHaveLength(1);
    expect(loadConfigFile(join(root, 'chosen.yaml')).warnings).toEqual([]);
  });

  it('is a usage error when the file does not exist', () => {
    expect(() => loadConfigFile(join(tempDir(), 'missing.yaml'))).toThrow(UsageError);
  });
});

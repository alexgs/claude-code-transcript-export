import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  ContentPolicy,
  ImagePolicy,
  ThinkingPolicy,
  ToolPolicy,
} from './types.js';

/** A bad flag, a bad config, a missing directory — anything the user can fix. */
export class UsageError extends Error {}

/** Config filenames, in precedence order. First match wins. */
export const CONFIG_NAMES = ['.claude-export.yaml', '.claude-export.json'] as const;

export interface IndexConfig {
  enabled: boolean;
  /** Project-specific prose, inserted verbatim. */
  preamble: string | null;
  listExcluded: 'count' | 'ids' | 'none';
}

export interface Config {
  out: string;
  include: string[];
  exclude: string[];
  tools: ToolPolicy;
  thinking: ThinkingPolicy;
  images: ImagePolicy;
  imageDir: string;
  subagents: 'ignore' | 'capture';
  skipEmpty: boolean;
  skipActive: boolean;
  activeGraceMinutes: number;
  commits: boolean;
  index: IndexConfig;
}

export const DEFAULT_CONFIG: Config = {
  out: 'docs/sessions',
  include: [],
  exclude: [],
  tools: 'strip',
  thinking: 'drop',
  images: 'extract',
  imageDir: 'images',
  subagents: 'ignore',
  skipEmpty: true,
  // Capturing an in-progress session is the default: a partial transcript
  // beats no transcript, and it self-heals on the next run. See spec §9.3.
  skipActive: false,
  activeGraceMinutes: 30,
  commits: false,
  index: { enabled: true, preamble: null, listExcluded: 'count' },
};

export interface ResolvedConfig {
  /** The directory holding the config file. This is the project root. */
  root: string;
  /** Absolute path of the config file, or null when defaults were used. */
  configPath: string | null;
  config: Config;
}

/**
 * The nearest config file at or above `from`.
 *
 * The directory containing it is the project root, which is what makes `cctx`
 * work from any subdirectory. The walk stops at the filesystem root; a config
 * in an unexpected parent silently claiming a nested repo is the one failure
 * mode of walk-up discovery, which is why every run prints the root it
 * resolved.
 */
export function findConfig(from: string): string | null {
  let dir = resolve(from);

  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const ENUMS = {
  tools: ['strip', 'keep'],
  thinking: ['drop', 'keep'],
  images: ['extract', 'marker'],
  subagents: ['ignore', 'capture'],
} as const;

function assertEnum(key: keyof typeof ENUMS, value: unknown): void {
  const allowed: readonly string[] = ENUMS[key];
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new UsageError(
      `\`${key}\` must be one of ${allowed.join(' | ')}, got ${JSON.stringify(value)}.`,
    );
  }
}

function assertStringArray(key: string, value: unknown): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new UsageError(`\`${key}\` must be a list of session UUIDs.`);
  }
  return value as string[];
}

/**
 * Merges a parsed config object over the defaults.
 *
 * Unknown keys are an error naming the key, not a silent ignore: a typo in
 * `exclude` that quietly does nothing is how a session you meant to withhold
 * ends up in a committed transcript.
 */
export function mergeConfig(raw: unknown): Config {
  if (raw === null || raw === undefined) return { ...DEFAULT_CONFIG };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new UsageError('config must be a mapping of options.');
  }

  const source = raw as Record<string, unknown>;
  const config: Config = { ...DEFAULT_CONFIG, index: { ...DEFAULT_CONFIG.index } };

  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    switch (key) {
      case 'out':
      case 'imageDir':
        if (typeof value !== 'string' || value === '') {
          throw new UsageError(`\`${key}\` must be a non-empty path.`);
        }
        config[key] = value;
        break;
      case 'include':
      case 'exclude':
        config[key] = assertStringArray(key, value);
        break;
      case 'tools':
      case 'thinking':
      case 'images':
      case 'subagents':
        assertEnum(key, value);
        config[key] = value as never;
        break;
      case 'skipEmpty':
      case 'skipActive':
      case 'commits':
        if (typeof value !== 'boolean')
          throw new UsageError(`\`${key}\` must be true or false.`);
        config[key] = value;
        break;
      case 'activeGraceMinutes':
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          throw new UsageError('`activeGraceMinutes` must be a non-negative number.');
        }
        config.activeGraceMinutes = value;
        break;
      case 'index': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new UsageError('`index` must be a mapping.');
        }
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (k === 'enabled') {
            if (typeof v !== 'boolean')
              throw new UsageError('`index.enabled` must be true or false.');
            config.index.enabled = v;
          } else if (k === 'preamble') {
            if (v !== null && typeof v !== 'string') {
              throw new UsageError('`index.preamble` must be a string or null.');
            }
            config.index.preamble = v;
          } else if (k === 'listExcluded') {
            if (v !== 'count' && v !== 'ids' && v !== 'none') {
              throw new UsageError(
                '`index.listExcluded` must be one of count | ids | none.',
              );
            }
            config.index.listExcluded = v;
          } else {
            throw new UsageError(`unknown config key \`index.${k}\`.`);
          }
        }
        break;
      }
      default:
        throw new UsageError(`unknown config key \`${key}\`.`);
    }
  }

  return config;
}

/** Parses a config file by extension. */
export function parseConfigFile(path: string, contents: string): Config {
  let raw: unknown;
  try {
    raw = path.endsWith('.json') ? JSON.parse(contents) : parseYaml(contents);
  } catch (cause) {
    throw new UsageError(
      `${path} is not valid ${path.endsWith('.json') ? 'JSON' : 'YAML'}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
  return mergeConfig(raw);
}

/**
 * Discovers and loads the config, or reports that there is none.
 *
 * `projectOverride` skips discovery entirely, for `--project`: a root without a
 * config file, using defaults.
 */
export function loadConfig(
  from: string,
  projectOverride?: string,
): ResolvedConfig | null {
  if (projectOverride !== undefined) {
    return {
      root: resolve(projectOverride),
      configPath: null,
      config: { ...DEFAULT_CONFIG, index: { ...DEFAULT_CONFIG.index } },
    };
  }

  const configPath = findConfig(from);
  if (configPath === null) return null;

  return {
    root: dirname(configPath),
    configPath,
    config: parseConfigFile(configPath, readFileSync(configPath, 'utf8')),
  };
}

/** The content policy a config implies. */
export function contentPolicy(config: Config): ContentPolicy {
  return { tools: config.tools, thinking: config.thinking, images: config.images };
}

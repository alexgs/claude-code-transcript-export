import { UsageError } from '../config.js';

export type Command = 'extract' | 'list' | 'probe' | 'init' | 'help' | 'version';

export interface Options {
  command: Command;
  config?: string;
  project?: string;
  out?: string;
  logRoot?: string;
  keepTools: boolean;
  keepThinking: boolean;
  commits?: boolean;
  ignoreConfig: boolean;
  dryRun: boolean;
  json: boolean;
}

const COMMANDS: Command[] = ['extract', 'list', 'probe', 'init'];

const VALUE_FLAGS = new Set(['--config', '--project', '--out', '--log-root']);

/**
 * Parses argv.
 *
 * An unrecognized flag is an error naming the flag, never a silent ignore: a
 * misspelled `--project` that quietly extracts the wrong directory is worse
 * than a failure.
 */
export function parseArgs(argv: string[]): Options {
  const options: Options = {
    command: 'extract',
    keepTools: false,
    keepThinking: false,
    ignoreConfig: false,
    dryRun: false,
    json: false,
  };

  let index = 0;
  const first = argv[0];
  if (first !== undefined && !first.startsWith('-')) {
    if (!COMMANDS.includes(first as Command)) {
      throw new UsageError(
        `unknown command \`${first}\`. Expected one of ${COMMANDS.join(', ')}.`,
      );
    }
    options.command = first as Command;
    index = 1;
  }

  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;

    if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UsageError(`${arg} needs a path.`);
      }
      if (arg === '--config') options.config = value;
      else if (arg === '--project') options.project = value;
      else if (arg === '--out') options.out = value;
      else options.logRoot = value;
      index += 1;
      continue;
    }

    switch (arg) {
      case '--help':
      case '-h':
        options.command = 'help';
        break;
      case '--version':
      case '-v':
        options.command = 'version';
        break;
      case '--keep-tools':
        options.keepTools = true;
        break;
      case '--keep-thinking':
        options.keepThinking = true;
        break;
      case '--commits':
        options.commits = true;
        break;
      case '--no-commits':
        options.commits = false;
        break;
      case '--ignore-config':
        options.ignoreConfig = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--json':
        options.json = true;
        break;
      default:
        throw new UsageError(`unrecognized argument \`${arg}\`.`);
    }
  }

  return options;
}

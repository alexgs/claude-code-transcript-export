#!/usr/bin/env node
const USAGE = `cctx — extract Claude Code session logs into markdown transcripts.

Usage:
  cctx [extract]   Write transcripts for this project   (default)
  cctx list        Show every session and its status
  cctx probe       Report the observed log schema
  cctx init        Write a .claude-export.yaml here

Run \`cctx <command> --help\` for flags.`;

export function main(argv: string[]): number {
  process.stdout.write(`${USAGE}\n`);
  void argv;
  return 0;
}

process.exitCode = main(process.argv.slice(2));

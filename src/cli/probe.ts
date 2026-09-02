import { readLogFile } from '../discover.js';
import { isHumanTurn } from '../turns.js';
import type { RawRecord } from '../types.js';

/** Record types this package knows how to do something with. */
const HANDLED_RECORDS = new Set([
  'user',
  'assistant',
  'ai-title',
  'custom-title',
  'agent-name',
  'continued-in',
  'relocated',
]);

const HANDLED_BLOCKS = new Set([
  'text',
  'thinking',
  'tool_use',
  'tool_result',
  'image',
]);

export interface ProbeReport {
  files: number;
  recordTypes: Record<string, number>;
  blockTypes: Record<string, number>;
  userRecords: number;
  humanTurns: number;
  /** Record types seen that the renderer does not handle. */
  unhandledRecords: string[];
  unhandledBlocks: string[];
}

export function probeRecords(
  files: { path: string; records: RawRecord[] }[],
): ProbeReport {
  const recordTypes = new Map<string, number>();
  const blockTypes = new Map<string, number>();
  let userRecords = 0;
  let humanTurns = 0;

  for (const file of files) {
    for (const record of file.records) {
      const type = record.type ?? '(untyped)';
      recordTypes.set(type, (recordTypes.get(type) ?? 0) + 1);

      if (type === 'user') {
        userRecords += 1;
        if (isHumanTurn(record)) humanTurns += 1;
      }

      const content = record.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          const blockType = block?.type ?? '(untyped)';
          blockTypes.set(blockType, (blockTypes.get(blockType) ?? 0) + 1);
        }
      }
    }
  }

  const sorted = (map: Map<string, number>) =>
    Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));

  return {
    files: files.length,
    recordTypes: sorted(recordTypes),
    blockTypes: sorted(blockTypes),
    userRecords,
    humanTurns,
    unhandledRecords: [...recordTypes.keys()]
      .filter((t) => !HANDLED_RECORDS.has(t))
      .sort(),
    unhandledBlocks: [...blockTypes.keys()]
      .filter((t) => !HANDLED_BLOCKS.has(t))
      .sort(),
  };
}

export function probe(paths: string[]): ProbeReport {
  return probeRecords(paths.map((path) => ({ path, records: readLogFile(path) })));
}

export function formatProbe(report: ProbeReport): string {
  const lines: string[] = [`session logs: ${report.files}`];
  if (report.files === 0) return lines.join('\n');

  const table = (counts: Record<string, number>) =>
    Object.entries(counts).map(([key, value]) => `  ${key}: ${value}`);

  lines.push('', 'record types:', ...table(report.recordTypes));
  lines.push('', 'content block types:', ...table(report.blockTypes));

  const ratio =
    report.userRecords === 0
      ? '0'
      : ((report.humanTurns / report.userRecords) * 100).toFixed(1);
  lines.push(
    '',
    `user records: ${report.userRecords}, of which human turns: ${report.humanTurns} (${ratio}%)`,
    '(the difference is tool results and injected context, which are not turns)',
  );

  // The reason this command exists: the schema is observed, not documented.
  if (report.unhandledRecords.length > 0) {
    lines.push('', `record types this version does not handle:`);
    lines.push(...report.unhandledRecords.map((t) => `  ${t}`));
  }
  if (report.unhandledBlocks.length > 0) {
    lines.push('', `content blocks this version does not handle:`);
    lines.push(...report.unhandledBlocks.map((t) => `  ${t}`));
  }

  return lines.join('\n');
}

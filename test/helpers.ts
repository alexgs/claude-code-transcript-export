import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RawRecord } from '../src/types.js';

/** A scratch directory. Tests never read the developer's real logs. */
export function tempDir(prefix = 'cctx-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes a JSONL log, creating parent directories as needed. */
export function writeLog(path: string, records: RawRecord[]): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}

export const userRecord = (
  text: string,
  extra: Partial<RawRecord> = {},
): RawRecord => ({
  type: 'user',
  message: { role: 'user', content: text },
  ...extra,
});

export const assistantRecord = (
  text: string,
  extra: Partial<RawRecord> = {},
): RawRecord => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text }] },
  ...extra,
});

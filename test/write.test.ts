import { describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type Config } from '../src/config.js';
import { extract } from '../src/extract.js';
import {
  findOrphanImages,
  pruneExcluded,
  pruneRenamed,
  writeIfChanged,
  writeImages,
} from '../src/write.js';
import { renderTranscript } from '../src/render/transcript.js';
import { assistantRecord, tempDir, userRecord, writeLog } from './helpers.js';
import type { RawRecord, Session } from '../src/types.js';

const SESSION_ID = 'abcdef01-2345-6789-abcd-ef0123456789';

/** The conversation every scenario starts from, rooted at a real directory. */
const baseRecords = (project: string, title: string): RawRecord[] => [
  { type: 'mode', sessionId: SESSION_ID },
  { type: 'ai-title', aiTitle: title },
  userRecord('ask something', {
    sessionId: SESSION_ID,
    cwd: project,
    timestamp: '2026-08-24T21:13:00Z',
  }),
  assistantRecord('answer it', {
    sessionId: SESSION_ID,
    cwd: project,
    timestamp: '2026-08-24T21:14:00Z',
  }),
];

function config(over: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_CONFIG,
    out: 'transcripts',
    ...over,
    index: { ...DEFAULT_CONFIG.index, ...(over.index ?? {}) },
  };
}

/**
 * A log root and a project root, both under temp directories.
 *
 * The records' `cwd` is the project root itself, which is how membership is
 * actually decided — the encoded directory name is not consulted.
 */
function scenario(build?: (project: string) => RawRecord[], title = 'First session') {
  const logRoot = tempDir('cctx-logs-');
  const root = tempDir('cctx-proj-');
  const logPath = join(logRoot, 'encoded-project-dir', `${SESSION_ID}.jsonl`);
  writeLog(logPath, build ? build(root) : baseRecords(root, title));
  return { logRoot, root, logPath, outDir: join(root, 'transcripts') };
}

const run = (logRoot: string, root: string, cfg = config(), today = '2026-09-02') =>
  extract({
    logRoot,
    root,
    config: cfg,
    today,
    commits: [],
    now: Date.parse('2027-01-01'),
  });

describe('extract, end to end', () => {
  it('writes a transcript and an index', () => {
    const { logRoot, root, outDir } = scenario();
    const summary = run(logRoot, root);
    expect(summary.sessions).toBe(1);
    const names = readdirSync(outDir).sort();
    expect(names).toContain('index.md');
    expect(names.some((n) => n.endsWith('--abcdef01.md'))).toBe(true);
  });

  it('THE INVARIANT: a second run over unchanged logs writes nothing', () => {
    const { logRoot, root } = scenario();
    const first = run(logRoot, root);
    expect(first.written).toBeGreaterThan(0);

    // A later date, which is exactly the case that used to rewrite everything.
    const second = run(logRoot, root, config(), '2026-12-25');
    expect(second.written).toBe(0);
    expect(second.unchanged).toBe(first.written);
  });

  it('keeps the original extracted date when nothing else changed', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);
    run(logRoot, root, config(), '2026-12-25');
    const file = readdirSync(outDir).find((n) => n.endsWith('--abcdef01.md'))!;
    expect(readFileSync(join(outDir, file), 'utf8')).toContain('extracted: 2026-09-02');
  });

  it('bumps the extracted date when the content really changed', () => {
    const { logRoot, root, outDir, logPath } = scenario();
    run(logRoot, root);
    writeLog(logPath, [
      ...baseRecords(root, 'First session'),
      userRecord('one more thing', {
        sessionId: SESSION_ID,
        cwd: root,
        timestamp: '2026-08-24T21:20:00Z',
      }),
    ]);
    run(logRoot, root, config(), '2026-12-25');
    const file = readdirSync(outDir).find((n) => n.endsWith('--abcdef01.md'))!;
    expect(readFileSync(join(outDir, file), 'utf8')).toContain('extracted: 2026-12-25');
  });

  it('deletes the old transcript when a session is renamed, and reports it', () => {
    const { logRoot, root, outDir, logPath } = scenario(undefined, 'Original title');
    run(logRoot, root);
    expect(readdirSync(outDir)).toContain('2026-08-24--original-title--abcdef01.md');

    writeLog(logPath, [
      ...baseRecords(root, 'Original title'),
      { type: 'custom-title', customTitle: 'Renamed by hand' },
    ]);
    const summary = run(logRoot, root);

    const names = readdirSync(outDir);
    expect(names).toContain('2026-08-24--renamed-by-hand--abcdef01.md');
    expect(names).not.toContain('2026-08-24--original-title--abcdef01.md');
    expect(summary.removed).toEqual([
      { name: '2026-08-24--original-title--abcdef01.md', reason: 'renamed' },
    ]);
  });

  it('deletes a newly excluded transcript and reports it', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);
    expect(readdirSync(outDir).some((n) => n.endsWith('--abcdef01.md'))).toBe(true);

    const summary = run(logRoot, root, config({ exclude: [SESSION_ID] }));
    expect(readdirSync(outDir).some((n) => n.endsWith('--abcdef01.md'))).toBe(false);
    expect(summary.removed[0]?.reason).toBe('excluded');
    expect(summary.skipped[0]?.reason).toBe('excluded');
  });

  it('never syncs: a transcript whose log has vanished is left alone', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);
    const orphanTranscript = '2020-01-01--gone-forever--99999999.md';
    writeFileSync(join(outDir, orphanTranscript), '---\nextracted: 2020-01-01\n---\n');

    const summary = run(logRoot, root);
    expect(readdirSync(outDir)).toContain(orphanTranscript);
    expect(summary.removed).toEqual([]);
  });

  it('skips a session with no prose', () => {
    const { logRoot, root } = scenario((project) => [
      { type: 'mode', sessionId: SESSION_ID },
      { type: 'ai-title', aiTitle: 'Mechanical' },
      {
        type: 'user',
        sessionId: SESSION_ID,
        cwd: project,
        timestamp: '2026-08-24T21:13:00Z',
        message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] },
      },
    ]);
    const summary = run(logRoot, root);
    expect(summary.sessions).toBe(0);
    expect(summary.skipped[0]?.reason).toBe('empty');
  });

  it('skips the session it is running inside', () => {
    const { logRoot, root } = scenario();
    const summary = extract({
      logRoot,
      root,
      config: config(),
      today: '2026-09-02',
      currentSessionId: SESSION_ID,
      commits: [],
    });
    expect(summary.skipped[0]?.reason).toBe('active');
  });

  it('captures an active session by default', () => {
    const { logRoot, root } = scenario();
    const summary = extract({
      logRoot,
      root,
      config: config(),
      today: '2026-09-02',
      now: Date.parse('2026-08-24T21:15:00Z'),
      commits: [],
    });
    expect(summary.sessions).toBe(1);
  });

  it('skips an active session when asked to', () => {
    const { logRoot, root } = scenario();
    const summary = extract({
      logRoot,
      root,
      config: config({ skipActive: true }),
      today: '2026-09-02',
      now: Date.parse('2026-08-24T21:15:00Z'),
      commits: [],
    });
    expect(summary.skipped[0]?.reason).toBe('active');
  });

  it('writes nothing at all under dry run', () => {
    const { logRoot, root, outDir } = scenario();
    const summary = extract({
      logRoot,
      root,
      config: config(),
      today: '2026-09-02',
      dryRun: true,
      commits: [],
    });
    expect(summary.sessions).toBe(1);
    expect(existsSync(outDir)).toBe(false);
  });

  it('extracts an image once and reports orphans without deleting them', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const { logRoot, root, outDir } = scenario((project) => [
      { type: 'mode', sessionId: SESSION_ID },
      { type: 'ai-title', aiTitle: 'With a screenshot' },
      {
        type: 'user',
        sessionId: SESSION_ID,
        cwd: project,
        timestamp: '2026-08-24T21:13:00Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png },
            },
          ],
        },
      },
    ]);

    const first = run(logRoot, root);
    expect(first.imagesWritten).toHaveLength(1);

    const imageDir = join(outDir, 'images');
    writeFileSync(join(imageDir, 'abcdef01-deadbeef.png'), 'stale');

    const second = run(logRoot, root);
    // Written once; the hash-named file is not rewritten on a rerun.
    expect(second.imagesWritten).toHaveLength(0);
    expect(second.orphanImages).toEqual(['abcdef01-deadbeef.png']);
    // Reported, and still there.
    expect(existsSync(join(imageDir, 'abcdef01-deadbeef.png'))).toBe(true);
  });
});

/**
 * The case this exists for: the project moved to a machine its old logs never
 * reached. Simulated by running a second time against an empty log root, which
 * is exactly what `~/.claude/projects` looks like on a fresh box.
 */
describe('a project whose logs are gone', () => {
  it('keeps the index row, reading it back off the transcript', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);

    const summary = run(tempDir('cctx-empty-logs-'), root);
    expect(summary.sessions).toBe(0);
    expect(summary.carried.map((c) => c.id)).toEqual([SESSION_ID]);

    const index = readFileSync(join(outDir, 'index.md'), 'utf8');
    expect(index).toContain(`\`${SESSION_ID}\``);
    expect(index).toContain('| 2026-08-24 | First session | 2 |');
    expect(index).toContain('One row below was read back');
  });

  it('counts the carried transcript in the alternation statement', () => {
    const { logRoot, root, outDir } = scenario((project) => [
      ...baseRecords(project, 'First session'),
      // A second human turn in a row: a real alternation break, which must
      // still be reported once the log behind it is gone.
      userRecord('and another', {
        sessionId: SESSION_ID,
        cwd: project,
        timestamp: '2026-08-24T21:15:00Z',
      }),
      userRecord('and another again', {
        sessionId: SESSION_ID,
        cwd: project,
        timestamp: '2026-08-24T21:16:00Z',
      }),
    ]);
    run(logRoot, root);
    run(tempDir('cctx-empty-logs-'), root);

    expect(readFileSync(join(outDir, 'index.md'), 'utf8')).toContain(
      'there is 1 place',
    );
  });

  it('THE INVARIANT still holds: a rerun with no logs writes nothing', () => {
    const { logRoot, root } = scenario();
    run(logRoot, root);
    const empty = tempDir('cctx-empty-logs-');

    const first = run(empty, root);
    // The index changed once, gaining the carried-forward note.
    expect(first.written).toBe(1);
    expect(run(empty, root, config(), '2026-12-25').written).toBe(0);
  });

  it('never deletes the transcript itself', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);
    const summary = run(tempDir('cctx-empty-logs-'), root);

    expect(summary.removed).toEqual([]);
    expect(readdirSync(outDir)).toContain('2026-08-24--first-session--abcdef01.md');
  });

  it('does not report the images it still links to as orphans', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
    const { logRoot, root } = scenario((project) => [
      { type: 'mode', sessionId: SESSION_ID },
      { type: 'ai-title', aiTitle: 'With a screenshot' },
      {
        type: 'user',
        sessionId: SESSION_ID,
        cwd: project,
        timestamp: '2026-08-24T21:13:00Z',
        message: {
          role: 'user',
          content: [
            { type: 'text', text: 'look at this' },
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: png },
            },
          ],
        },
      },
    ]);
    const first = run(logRoot, root);
    expect(first.imagesWritten).toHaveLength(1);

    // Without the transcript scan this reports the image as an orphan, with
    // the command to delete the one output that cannot be regenerated.
    expect(run(tempDir('cctx-empty-logs-'), root).orphanImages).toEqual([]);
  });

  it('still honours an exclusion, deleting the transcript and dropping the row', () => {
    const { logRoot, root, outDir } = scenario();
    run(logRoot, root);

    const summary = run(
      tempDir('cctx-empty-logs-'),
      root,
      config({ exclude: [SESSION_ID] }),
    );
    expect(summary.carried).toEqual([]);
    expect(summary.removed).toEqual([
      { name: '2026-08-24--first-session--abcdef01.md', reason: 'excluded' },
    ]);
    expect(readFileSync(join(outDir, 'index.md'), 'utf8')).not.toContain(SESSION_ID);
  });

  it('reports what it would carry on a dry run, and writes nothing', () => {
    const { logRoot, root } = scenario();
    run(logRoot, root);

    const summary = extract({
      logRoot: tempDir('cctx-empty-logs-'),
      root,
      config: config(),
      today: '2026-12-25',
      commits: [],
      dryRun: true,
    });
    expect(summary.carried).toHaveLength(1);
    expect(summary.written).toBe(0);
  });
});

describe('writeIfChanged', () => {
  it('preserves a body that contains an extracted: line', () => {
    const dir = tempDir();
    const path = join(dir, 't.md');
    const session = {
      id: 'abcdef01',
      title: 'Quoting frontmatter',
      created: '2026-08-24',
      updated: '2026-08-24',
      cwds: [],
      turns: [{ speaker: 'Human' as const, text: 'extracted: 1999-01-01' }],
      images: [],
      rawMessages: 1,
    } satisfies Session;

    const render = (extractedOn: string) => renderTranscript(session, { extractedOn });
    expect(writeIfChanged(path, render, '2026-09-02')).toBe(true);
    // The body line must not be mistaken for the header on the second pass.
    expect(writeIfChanged(path, render, '2026-12-25')).toBe(false);
    expect(readFileSync(path, 'utf8')).toContain('extracted: 2026-09-02');
    expect(readFileSync(path, 'utf8')).toContain('extracted: 1999-01-01');
  });
});

describe('pruneRenamed', () => {
  it('ignores a file for a session this run did not write', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-01-01--other--12345678.md'), 'x');
    expect(pruneRenamed(dir, ['2026-01-01--mine--abcdef01.md'])).toEqual([]);
  });

  it('ignores files that do not match the transcript name shape', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'README.md'), 'x');
    expect(pruneRenamed(dir, [])).toEqual([]);
    expect(existsSync(join(dir, 'README.md'))).toBe(true);
  });
});

describe('pruneExcluded', () => {
  it('does nothing when the exclude list is empty', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2026-01-01--x--abcdef01.md'), 'x');
    expect(pruneExcluded(dir, [])).toEqual([]);
  });
});

describe('writeImages', () => {
  it('creates the directory and skips an existing hash-named file', () => {
    const dir = join(tempDir(), 'images');
    const image = {
      filename: 'abcdef01-11111111.png',
      mediaType: 'image/png',
      data: Buffer.from([1, 2, 3]),
    };
    expect(writeImages(dir, [image])).toEqual(['abcdef01-11111111.png']);
    expect(writeImages(dir, [image])).toEqual([]);
  });
});

describe('findOrphanImages', () => {
  it('returns nothing when the directory does not exist', () => {
    expect(findOrphanImages(join(tempDir(), 'nope'), new Set())).toEqual([]);
  });

  it('lists only unreferenced files', () => {
    const dir = tempDir();
    mkdirSync(join(dir, 'images'), { recursive: true });
    writeFileSync(join(dir, 'images', 'a.png'), 'a');
    writeFileSync(join(dir, 'images', 'b.png'), 'b');
    expect(findOrphanImages(join(dir, 'images'), new Set(['a.png']))).toEqual([
      'b.png',
    ]);
  });
});

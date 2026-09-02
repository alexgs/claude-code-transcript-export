import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  belongsToProject,
  discover,
  listLogFiles,
  parseRecords,
  readIdentity,
} from '../src/discover.js';
import { UsageError } from '../src/config.js';
import { assistantRecord, tempDir, userRecord, writeLog } from './helpers.js';
import type { RawRecord } from '../src/types.js';

/**
 * A log root shaped like the real thing, including the nested subagent store
 * that a recursive scan would wrongly pick up.
 */
function fixtureRoot(project = '/work/proj') {
  const root = tempDir();
  const encoded = join(root, project.replace(/\//g, '-'));
  const parentId = '11111111-aaaa-bbbb-cccc-222222222222';

  writeLog(join(encoded, `${parentId}.jsonl`), [
    { type: 'mode', mode: 'normal', sessionId: parentId },
    { type: 'ai-title', aiTitle: 'Real session', sessionId: parentId },
    userRecord('hello', {
      sessionId: parentId,
      cwd: project,
      timestamp: '2026-08-24T21:13:00Z',
    }),
    assistantRecord('hi', {
      sessionId: parentId,
      cwd: project,
      timestamp: '2026-08-24T21:14:00Z',
    }),
  ]);

  // Subagent traffic: nested, isSidechain true, and carrying the PARENT's id.
  writeLog(join(encoded, parentId, 'subagents', 'agent-deadbeef.jsonl'), [
    userRecord('subagent prompt', {
      sessionId: parentId,
      cwd: project,
      isSidechain: true,
      timestamp: '2026-08-24T21:13:30Z',
    }),
    assistantRecord('subagent reply', {
      sessionId: parentId,
      cwd: project,
      isSidechain: true,
      timestamp: '2026-08-24T21:13:40Z',
    }),
  ]);

  return { root, encoded, parentId, project };
}

describe('listLogFiles', () => {
  it('does not descend into a session subagents directory', () => {
    const { root, parentId } = fixtureRoot();
    const files = listLogFiles(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain(`${parentId}.jsonl`);
    expect(files.some((f) => f.includes('subagents'))).toBe(false);
  });

  it('rejects a missing log root with a usage error', () => {
    expect(() => listLogFiles('/no/such/place')).toThrow(UsageError);
  });
});

describe('discover', () => {
  it('finds the real session and not the subagent log', () => {
    const { root, project, parentId } = fixtureRoot();
    const found = discover(root, project);
    expect(found).toHaveLength(1);
    expect(found[0]?.sessionId).toBe(parentId);
  });

  it('matches a session launched from a subdirectory', () => {
    const root = tempDir();
    writeLog(join(root, '-work-proj-scripts', 'sub.jsonl'), [
      userRecord('x', { sessionId: 'sub', cwd: '/work/proj/scripts' }),
    ]);
    expect(discover(root, '/work/proj')).toHaveLength(1);
  });

  it('matches a worktree pointed at by a relocated record', () => {
    const root = tempDir();
    writeLog(join(root, '-work-proj', 'wt.jsonl'), [
      { type: 'mode', sessionId: 'wt' },
      {
        type: 'relocated',
        sessionId: 'wt',
        relocatedCwd: '/work/proj/.claude/worktrees/spike',
      },
    ]);
    expect(discover(root, '/work/proj')).toHaveLength(1);
  });

  it('ignores a session belonging to a different project', () => {
    const root = tempDir();
    writeLog(join(root, '-work-other', 'o.jsonl'), [
      userRecord('x', { sessionId: 'o', cwd: '/work/other' }),
    ]);
    expect(discover(root, '/work/proj')).toHaveLength(0);
  });

  it('does not match a sibling sharing a name prefix', () => {
    const root = tempDir();
    writeLog(join(root, '-work-project2', 'p.jsonl'), [
      userRecord('x', { sessionId: 'p', cwd: '/work/proj2' }),
    ]);
    expect(discover(root, '/work/proj')).toHaveLength(0);
  });
});

describe('belongsToProject', () => {
  it('rejects a sidechain log even if its cwd matches', () => {
    const records: RawRecord[] = [
      userRecord('x', { sessionId: 's', cwd: '/work/proj', isSidechain: true }),
    ];
    const identity = readIdentity('/x.jsonl', records);
    expect(identity.sidechain).toBe(true);
    expect(belongsToProject(identity, '/work/proj')).toBe(false);
  });
});

describe('readIdentity', () => {
  it('finds cwd past a leading mode record', () => {
    const records: RawRecord[] = [
      { type: 'mode', mode: 'normal' },
      { type: 'permission-mode' },
      userRecord('x', { sessionId: 'abc', cwd: '/work/proj' }),
    ];
    expect(readIdentity('/x.jsonl', records).cwds).toEqual(['/work/proj']);
  });

  it('collects a relocation alongside the original cwd', () => {
    const records: RawRecord[] = [
      userRecord('x', { sessionId: 'a', cwd: '/work/proj' }),
      { type: 'relocated', relocatedCwd: '/work/proj/.claude/worktrees/w' },
    ];
    expect(readIdentity('/x.jsonl', records).cwds).toHaveLength(2);
  });
});

describe('parseRecords', () => {
  it('skips a truncated final line rather than failing the run', () => {
    const records = parseRecords('{"type":"user"}\n{"type":"assi');
    expect(records).toHaveLength(1);
  });
});

describe('discover, renamed projects', () => {
  /**
   * The case this exists for. A project renamed from `old-name` to `new-name`
   * has its log directory moved by Claude Code, but every record written before
   * the rename still carries the old `cwd` forever.
   */
  function renamedProject() {
    const logRoot = tempDir();
    const root = '/work/new-name';
    const dir = join(logRoot, '-work-new-name');

    writeLog(join(dir, 'before-rename.jsonl'), [
      { type: 'mode', sessionId: 'before' },
      userRecord('old work', { sessionId: 'before', cwd: '/work/old-name' }),
    ]);
    writeLog(join(dir, 'after-rename.jsonl'), [
      { type: 'mode', sessionId: 'after' },
      userRecord('new work', { sessionId: 'after', cwd: root }),
    ]);

    return { logRoot, root };
  }

  it('finds sessions from before the rename', () => {
    const { logRoot, root } = renamedProject();
    const ids = discover(logRoot, root)
      .map((log) => log.sessionId)
      .sort();
    expect(ids).toEqual(['after', 'before']);
  });

  it('still rejects a sidechain log sitting in the right directory', () => {
    const { logRoot, root } = renamedProject();
    writeLog(join(logRoot, '-work-new-name', 'sub.jsonl'), [
      userRecord('subagent', { sessionId: 'sub', cwd: root, isSidechain: true }),
    ]);
    expect(discover(logRoot, root).map((l) => l.sessionId)).not.toContain('sub');
  });

  it('does not pull in an unrelated project directory', () => {
    const { logRoot, root } = renamedProject();
    writeLog(join(logRoot, '-work-somethingelse', 'other.jsonl'), [
      userRecord('other', { sessionId: 'other', cwd: '/work/somethingelse' }),
    ]);
    expect(discover(logRoot, root).map((l) => l.sessionId)).not.toContain('other');
  });

  it('matches on cwd when the directory name does not match', () => {
    // A subdirectory launch: different directory name, cwd inside the project.
    const logRoot = tempDir();
    writeLog(join(logRoot, '-work-new-name-scripts', 's.jsonl'), [
      userRecord('x', { sessionId: 's', cwd: '/work/new-name/scripts' }),
    ]);
    expect(discover(logRoot, '/work/new-name')).toHaveLength(1);
  });
});

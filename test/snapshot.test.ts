import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRecords } from '../src/discover.js';
import { probeRecords } from '../src/cli/probe.js';
import { readSession } from '../src/session.js';
import { renderTranscript } from '../src/render/transcript.js';
import { parseTranscript } from '../src/carry.js';
import { parityReport } from '../src/turns.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const fixture = (name: string) =>
  parseRecords(readFileSync(join(HERE, 'fixtures', name), 'utf8'));

/**
 * Snapshots over a checked-in fixture that exercises every record and block
 * type this version handles, plus two it does not.
 *
 * What this guards and what it does not, stated plainly. It catches *our*
 * regressions: a change to the turn filter, the content policy, or the
 * frontmatter shows up here as a failing diff. It cannot catch Claude Code
 * changing its log format, because CI has no real logs to look at — and
 * upstream drift is the risk this project actually has. Detecting that stays a
 * local, manual act: run `cctx probe` against real logs, and update these
 * fixtures when the schema has moved.
 */
describe('schema snapshot', () => {
  const records = fixture('session.jsonl');

  it('sees the record and block types it expects', () => {
    const report = probeRecords([{ path: 'session.jsonl', records }]);
    expect({
      recordTypes: report.recordTypes,
      blockTypes: report.blockTypes,
      userRecords: report.userRecords,
      humanTurns: report.humanTurns,
    }).toMatchSnapshot();
  });

  it('names record and block types this version does not handle', () => {
    const report = probeRecords([{ path: 'session.jsonl', records }]);
    // Present so that a type gaining real handling has to update this list
    // deliberately rather than silently.
    expect(report.unhandledRecords).toMatchSnapshot();
    expect(report.unhandledBlocks).toMatchSnapshot();
  });

  it('renders a stable transcript', () => {
    const session = readSession(records);
    expect(renderTranscript(session, { extractedOn: '2026-09-02' })).toMatchSnapshot();
  });

  it('round-trips: what it renders, it can read back', () => {
    // The coupling this guards is the one the index depends on. `carry.ts`
    // rebuilds an index row out of a rendered transcript, so a change to the
    // frontmatter keys or the `## [N] Speaker` heading breaks the recovery of
    // every transcript whose log has since been pruned — silently, and only on
    // a machine that no longer has those logs to notice with.
    const session = readSession(records);
    const doc = renderTranscript(session, { extractedOn: '2026-09-02' });

    expect(parseTranscript('fixture.md', doc)).toEqual({
      filename: 'fixture.md',
      id: session.id,
      title: session.title,
      created: session.created,
      turns: session.turns.length,
      parity: parityReport(session.turns),
      images: session.images.map((i) => i.filename),
    });
  });

  it('derives the session metadata it should', () => {
    const session = readSession(records);
    expect({
      id: session.id,
      title: session.title,
      created: session.created,
      updated: session.updated,
      kind: session.kind,
      continuedIn: session.continuedIn,
      cwds: session.cwds,
      turnCount: session.turns.length,
      speakers: session.turns.map((t) => t.speaker),
      images: session.images.map((i) => i.filename),
    }).toMatchSnapshot();
  });
});

describe('subagent fixture', () => {
  it('is entirely sidechain, which is what keeps it out of a transcript', () => {
    const records = fixture(join('subagents', 'agent-deadbeef.jsonl'));
    expect(records.every((r) => r.isSidechain === true)).toBe(true);
    // And it carries the parent's session id, which is why a recursive scan
    // would file it under a UUID that already belongs to a real transcript.
    expect(records[0]?.sessionId).toBe('fixture0-1111-2222-3333-444444444444');
    expect(readSession(records).turns).toHaveLength(0);
  });
});

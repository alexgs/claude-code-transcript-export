# Implementation plan — initial specification

Implements [`docs/specs/01-initial-specification.md`](../specs/01-initial-specification.md).
Section references below (§) point into that document; this plan does not
restate decisions, only sequences them.

## Ordering principle

Build outward from the parts that touch nothing. The parsing and rendering core
is pure by design (§9.1), so it can be fully tested before a single file is
read or written. Discovery comes next because it decides *which* logs exist;
the write layer comes last because it is the only place that can destroy
anything.

One consequence worth stating: **phases 1–4 produce no working CLI.** That is
deliberate. The alternative — a thin end-to-end slice first — would put the
deletion rules (§10) in front of the test suite that makes them safe.

## Proposed layout

```
src/
  types.ts          record, session, turn, config types
  content.ts        harness tags, blocks, content policy      (§6, §6.1)
  turns.ts          human-turn predicate, coalescing          (§7)
  session.ts        records -> Session, titles, links          (§6, §8.1)
  config.ts         walk-up discovery, load, defaults          (§4.1, §5)
  discover.ts       depth-1 scan, identity, cwd matching       (§4.2-4.4)
  images.ts         decode, hash, name                         (§6.1)
  render/
    transcript.ts   pure; takes extractedOn                    (§8.1, §9.1)
    index.ts        pure; parity check, exclusions             (§8.3)
  write.ts          compare-and-write, prior date, deletions   (§9.2, §10)
  extract.ts        orchestration
  cli/
    index.ts        arg parsing, dispatch, reporting           (§11)
    list.ts  probe.ts  init.ts
  index.ts          library exports                            (§12)
test/
  fixtures/         checked-in synthetic JSONL
```

## Phase 0 — scaffolding and CI

- `package.json`: name and bin `cctx`, `type: module`, `engines.node >= 22`,
  single runtime dep `yaml`, dev deps `typescript` / `vitest` / `prettier`.
- `tsconfig.json`: emit JS + declarations (the reference implementation's is
  `noEmit`, which is wrong for a published package). Strict, `NodeNext`,
  `noUncheckedIndexedAccess`.
- `exports` map with both the library entry and `./package.json`.

`.github/workflows/ci.yml`, on push and pull request:

- Matrix over Node 22 (the floor declared in `engines`) and current LTS.
- `npm ci` → `format:check` → `typecheck` → `test` → `build`.
- `permissions: contents: read` at the top level; the job needs nothing more.

**Done when:** `npm run build` emits `dist/` with `.d.ts`, `npx .` prints
usage, and CI is green on a pull request.

### 0.1 CI forces the log root to be injectable

CI has no `~/.claude/projects`, and it must never grow one. Every test reads
from checked-in fixtures, which is not merely a testing convention — it is an
**API requirement**, and it needs to land in phase 0 rather than be retrofitted:

- `discover()` takes the logs root as a parameter, defaulting to
  `join(homedir(), '.claude', 'projects')`. It does not call `homedir()`
  internally.
- Nothing below the CLI layer reads `homedir()`, `process.env`, or the clock.
  `extractedOn` is already a parameter (§9.1); the logs root and
  `CLAUDE_CODE_SESSION_ID` (§9.3) join it.

Retrofitting this is painful because it reaches every call site at once. Doing
it first costs nothing.

### 0.2 What CI cannot do

The `probe` snapshot test (phase 7) compares the parser against **checked-in
fixtures**, so it catches *our* regressions. It cannot catch Claude Code
changing its format, because CI has no real logs to look at — and upstream
drift is the risk this project actually has (§14.1 of the spec: two decisions
reversed by observation in one afternoon).

So drift detection stays a local, manual act: run `cctx probe` against real
logs when something looks wrong, and update fixtures when it has moved. CI
guards the code; only a human with real logs guards the assumptions. The README
should say this rather than let a green badge imply otherwise.

## Phase 1 — pure core

Port from the reference implementation, with the spec's changes:

| Piece | Source | Change |
| --- | --- | --- |
| `stripHarnessTags` | port | none |
| `slugify`, `fence` | port from `extract-conversations.ts` | vendor, drop the rest |
| `isHumanTurn` | port | none (§7.2) |
| `buildTurns` | port | none (§7.3) |
| `toLocalDate` | port | none (§8.2) |
| `renderBlock` | port | `image` case is new (§6.1); tool/thinking defaults flip |
| title resolution | **new** | `custom-title > ai-title > agent-name` (§6) |

**Tests.** Unit, no filesystem. The load-bearing ones:

- A record whose content is entirely `tool_result` is not a human turn.
- A record that is only a slash-command expansion strips to empty and produces
  no turn — the `/clear` case that would otherwise desynchronize numbering.
- Consecutive assistant records coalesce into exactly one turn.
- `custom-title` beats `ai-title` even when the `ai-title` is later in the file.
- An unknown block type renders a visible marker, never nothing.

**Done when:** the human-turn predicate reproduces the §3 ratio on a fixture
built from real record shapes.

## Phase 2 — config and discovery

- `findConfig`: walk up to filesystem root, `.claude-export.yaml` then
  `.claude-export.json`, first match wins (§4.1).
- `loadConfig`: parse, apply defaults, reject unknown keys with a message
  naming the key. Precedence: flags > `--config` / `--project` > discovered >
  defaults.
- `discover`: **`~/.claude/projects/*/*.jsonl`, depth one, never recursive**
  (§4.4). Identity scan capped at 50 records for `sessionId` + `cwd`.
- Matching: project root or descendant, including `relocatedCwd` (§4.2).

**Tests.** These encode the two findings that reversed the design, so they are
regression tests for the spec itself, not just the code:

- A fixture tree containing `<project>/<uuid>/subagents/agent-x.jsonl` is
  **not** discovered. Guards the depth-one rule.
- A record with `isSidechain: true` is dropped even if it reaches the parser.
  Second defense, independent of the first.
- A session whose `cwd` is a subdirectory of the root is matched.
- A `relocatedCwd` under `.claude/worktrees/` is matched.
- Walk-up finds a config three directories up; the resolved root is returned
  for printing (§4.1).

## Phase 3 — sessions

`readSession`: records → `Session`. Timestamps at full precision alongside
local dates (§8.2), `continued_in` from the record, `kind` from `sessionKind`.

Reverse links (`continues`) are computed **across the run**, after all sessions
are read — a second pass over the in-memory set, not a re-read.

**Tests:** a two-file fixture where A declares `continuedInSessionId: B`
produces `continued_in` on A and `continues` on B.

## Phase 4 — rendering

- `renderTranscript(session, { extractedOn, images })` — pure. No clock, no fs.
- `renderIndex(sessions, { excluded, preamble })` — pure. Parity is **computed
  and reported**, never asserted (§8.3).
- `images.ts`: decode base64, SHA-256, `<id8>-<hash8>.<ext>`, extension from
  `media_type` with a marker fallback (§6.1). Returns descriptors; writing is
  phase 5's job.

**Tests:**

- Rendering the same session twice with the same `extractedOn` is byte-identical.
- Two identical images in different sessions produce the same filename.
- An unknown `media_type` falls back to a marker and emits no file.
- Index parity line changes when a fixture is given a non-alternating turn.

## Phase 5 — the write layer

The only phase that can lose data. Implement in this order:

1. `readPriorExtractedDate(format, path)` — per-format header read, **not** a
   regex over the body (§9.2). A transcript body containing `extracted:` at
   line start must not be matched; make that a test.
2. `writeIfChanged`: render with prior date → compare bytes → if different,
   re-render with today's date and write.
3. Image writes, skipped when the hash-named file already exists.
4. Deletions (§10), in the spec's order: renames, then newly-excluded, then
   orphan images **reported only**, then nothing else ever.

**Tests**, in a temp directory:

- **The headline invariant:** run twice over an unchanged fixture; the second
  run writes zero files and reports zero changes.
- A body containing a line beginning `extracted:` survives untouched.
- Renaming a session's title deletes the old filename and reports it.
- Adding a UUID to `exclude` deletes its transcript and reports it.
- An orphaned image is reported and **still present on disk** afterwards.
- A transcript whose source log has vanished is left alone (the no-sync rule).

## Phase 6 — CLI

`extract` (default), `list`, `probe`, `init` (§11). Exit codes 0/1/2.

`list` is not optional (§5.1): UUID-only selection is unusable without it.
Build it immediately after `extract`, not last.

Every run prints the resolved project root (§4.1). `--json` emits the summary
as structured output so a wrapper script can chain off it.

**Tests:** exit codes; `--dry-run` writes nothing; unknown flag produces a
usage error mentioning the flag; `probe` output includes any record type the
renderer does not handle.

## Phase 7 — packaging

- README from §1–2 plus a worked example.
- `npm pack` inspection: dist + types + README + LICENSE, nothing else.
- A `probe` snapshot test over checked-in fixtures, so **schema drift fails a
  test** rather than silently degrading output (§3.1). This is the phase's most
  valuable artifact.
- `.github/workflows/release.yml`, on a version tag: `npm ci` → full CI suite →
  `npm publish --provenance --access public`. Needs `id-token: write` and
  trusted publishing configured on the npm side.
- `npm pack --dry-run` runs in CI on every push, so a packaging mistake fails
  before a tag, not after.
- Publish `0.1.0`.

## Phase 8 — migrate Protocol Era

1. Add `.claude-export.yaml`: `out: sources/sessions`, `commits: true`, existing
   index prose moved verbatim into `index.preamble` (§15).
2. Run `cctx` alongside the old script; diff the two output trees.
3. Expect and verify the differences: new frontmatter fields, the exclusion
   line, `custom-title` now winning where a session was hand-renamed.
4. Delete `scripts/extract-sessions.ts` and its test; keep the project-specific
   housekeeping steps chained after `cctx`.

**Done when:** the housekeeping workflow runs end-to-end with `cctx` in place
and the diff contains only expected changes.

## Risks

**Schema drift is the standing risk**, not a one-off. Two decisions in this
document's spec were reversed by observation in a single afternoon (§14.1).
Mitigation is structural: `probe` as a command, a snapshot test over fixtures,
and unknown record types ignored-but-counted rather than assumed absent.

**The `sessionId` collision in subagent logs** (§4.4) is the failure most
likely to recur, because it is quiet — it produces a plausible document rather
than an error. Both defenses have tests in phase 2; neither should be removed
without the other.

**Deletion is irreversible where logs have been pruned.** Phase 5 is ordered so
the no-sync rule and the orphan-report rule are implemented and tested before
anything else in the write path is trusted.

## Sequencing summary

```
0 scaffolding
1 pure core ────┐
2 discovery ────┼──> 4 rendering ──> 5 write ──> 6 CLI ──> 7 package ──> 8 migrate
3 sessions  ────┘
```

Phases 1–3 are independent of each other and can be built in any order. Phase 5
must not begin before phase 4's tests pass.

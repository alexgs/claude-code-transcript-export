# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`cctx` reads Claude Code's own JSONL session logs from `~/.claude/projects/` and
writes them as markdown transcripts into a project's repository. Published as
`@alexgsdev/claude-code-transcript-export`; the binary is `cctx`.

The design and its reasoning live in `docs/specs/01-initial-specification.md`,
with later decisions in the numbered documents beside it, each naming the
sections of 01 it amends. **Read the relevant section before changing
behaviour** — most non-obvious choices there are answers to a failure that
already happened, and the section numbers are cited throughout the source.

## Commands

```sh
npm test                          # full suite
npx vitest run test/turns.test.ts # one file
npx vitest -t "coalesces"         # one test by name
npm run typecheck
npm run format:check              # CI runs this; `npm run format` to fix
npm run build                     # emits dist/ with declarations

node dist/cli/index.js list --project /path/to/some/project   # run the built CLI
```

Node is pinned to 22 via Volta because the machine default may be older than the
`engines` floor. If `npm test` fails in a way that makes no sense, check
`node --version` first.

## Architecture

A pipeline, built so the interesting half needs no filesystem:

```
discover.ts   find logs belonging to a project      (I/O)
session.ts    records -> Session                    (pure)
turns.ts      the turn model                        (pure)
content.ts    blocks -> markdown, image extraction  (pure)
render/       Session -> markdown                   (pure)
write.ts      compare-and-write, deletion rules     (I/O)
extract.ts    orchestration
cli/          argument parsing, reporting           (I/O, clock, env)
```

**Nothing below `cli/` reads the clock, the environment, or the home
directory.** Where a function needs one, it takes it as a parameter:
`extractedOn`, `logRoot`, `currentSessionId`, `now`. This is not style — it is
what lets the test suite run in CI, which has no `~/.claude/projects` and must
never grow one. Every test reads checked-in fixtures or a temp directory.
Breaking this rule reaches every call site at once.

## Invariants that look like details

Each of these has a test. If you find yourself "simplifying" one, read the
linked spec section first — they are all counter-intuitive on purpose.

**The log scan is depth-one and must never recurse** (spec §4.4). Subagent
transcripts live at `<project>/<parent-session-id>/subagents/*.jsonl` and carry
the *parent's* `sessionId` plus a matching `cwd`. A recursive walk accepts them
as project sessions and files them under a UUID that already belongs to a real
transcript — producing not an error but a second, wrong document. `isSidechain`
is dropped separately as a second, independent defense; keep both.

**Project membership is directory name OR recorded `cwd`.** Neither alone
works. Claude Code moves a project's log directory when the project is renamed,
but `cwd` inside already-written records keeps naming the old path forever, so
`cwd` alone silently drops every session from before a rename. The directory
name alone misses subdirectory launches and worktree relocations. The encoding
is only ever generated, never decoded — it is lossy.

**A rerun over unchanged logs must write zero files.** `writeIfChanged` renders
with the `extracted:` date already on disk, compares bytes, and only stamps
today's date when something else changed. `readExtractedDate` reads the leading
frontmatter block *only*: a transcript body is arbitrary prose and may quote
`extracted:` at line start.

**Deletion is narrow, and the output is the durable copy.** Renamed and
newly-excluded transcripts are deleted and reported. Orphaned images are
reported and left on disk. Nothing else is ever removed, and the tool must never
sync the output directory to the logs — the logs get pruned, so a sync would
delete precisely the transcripts that can no longer be regenerated.

**The index is rebuilt from the output directory, not only from the logs**
(spec 03). Every transcript on disk is read before anything is written; one
whose session id no log this run saw can regenerate keeps its row, with the
turn count from its frontmatter and its alternation re-measured from its
`## [N] Speaker` headings. Without this, running on a machine the old logs
never reached — a new dev box, a reinstall — rewrites `index.md` down to what
that machine happens to hold, and reports every older session's images as
orphans with the command to delete them. The headings are believed only when
they number 1..n and agree with `turns:`; a body may quote a heading, and a
half-parsed speaker sequence would report breaks that are not there.

**Turn alternation is measured as adjacent same-speaker pairs**, never as
`index % 2`. One break early in a long session flips every turn after it: the
index-parity version reported 61 breaks in a corpus that had 4.

## Testing against reality

The suite guards regressions in this code. **It cannot detect Claude Code
changing its log format**, because CI has no real logs. Several bugs in this
repo's history were invisible to the tests and to `npm run build`, and only
appeared when the tool was run against real logs or installed from a packed
tarball.

So before trusting a change to parsing or discovery:

```sh
node dist/cli/index.js probe --project /some/real/project   # names unhandled record types
npm pack && npm install <tarball>                           # catches packaging and symlink bugs
```

`test/fixtures/` holds a synthetic log exercising every record and block type
this version handles plus two it does not; `test/snapshot.test.ts` fails when
handling changes. Update fixtures deliberately when the schema moves.

## Conventions

- Prose is excluded from Prettier (`docs/`, `*.md` in `.prettierignore`).
  Running `npm run format` used to rewrite the spec's emphasis markers; don't
  re-add those paths.
- Comments carry the *why*, at some length, where a decision is not obvious from
  the code. Match that density rather than stripping it.
- Releases: bump `version` in `package.json`, merge, then tag `v<version>`.
  `.github/workflows/release.yml` publishes via npm trusted publishing with no
  token. It runs Node 24 deliberately — trusted publishing needs npm ≥ 11.5.1,
  and no Node 22 release bundles npm 11.

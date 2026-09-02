# claude-code-transcript-export — specification

Status: draft for review. Nothing here is implemented yet.

A general-purpose tool that turns local Claude Code session logs into readable,
committable transcripts. Extracted from `protocol-era/scripts/extract-sessions.ts`,
which is the reference implementation and the source of most decisions recorded
below.

## 1. Purpose

Claude Code transcripts exist in exactly one place: JSONL files under
`~/.claude/projects/`, on the machine where the work happened. They are not in
the claude.ai account export and never will be. They are also not durable —
they are a cache, subject to pruning by a tool that does not consider them
precious.

So the tool has one job: **move sessions from a location that forgets into one
that remembers**, in a format a human can read and a repository can diff.

Everything else in this document is downstream of that. Where a decision is
close, it goes to whichever option loses less when the logs disappear.

## 2. Scope

In scope:

- Reading Claude Code JSONL session logs.
- Selecting the sessions belonging to one project.
- Rendering them as markdown transcripts plus an index.
- Doing so idempotently, so reruns produce no spurious diffs.
- A library API, so a consuming project can build something else on the parse.

Out of scope, explicitly:

- claude.ai account exports. The reference implementation shares helpers with an
  export reader; those helpers get vendored and trimmed, not the feature.
- Editing, summarizing, or interpreting transcript content.
- Uploading anything anywhere.
- Reconstructing sessions already pruned from disk.

## 3. Observed data

The reference implementation was written against 7 sessions. This spec is
written against 84 logs in 11 projects on the author's machine, probed
2026-09-02. Numbers below are from that corpus and are *observations, not
guarantees* — the JSONL schema is undocumented and drifts.

Record types, by count:

```
assistant 17827   user 10832   attachment 8211   mode 2622   last-prompt 2600
ai-title 2574   permission-mode 1931   atis-latch 1416   bridge-session 1233
system 1144   file-history-snapshot 873   file-history-delta 393
agent-name 346   custom-title 158   queue-operation 148   cost-state 90
relocated 70   worktree-state 70   agent-setting 65   continued-in 1
```

Content block types: `tool_use` 9862, `tool_result` 9861, `thinking` 4925,
`text` 3058, `image` 5.

**Of 10832 `user` records, 778 are the human actually speaking — 7.2%.** The
other 92.8% are tool results and injected context. This is the single most
important number in the document; see §7.2.

The reference implementation handles three record types (`user`, `assistant`,
`ai-title`) out of the twenty above. It is not wrong — unknown types are
ignored — but four of the seventeen it ignores carry information this tool
should keep. See §6.

### 3.1 Drift already observed

- `isSidechain` is `false` in all 84 top-level logs, which initially looked
  like the flag had been abandoned. It has not: it is `true` on **every** record
  of a subagent log, and subagent logs live one directory deeper than anything
  the reference implementation reads (§4.4). The filter is not dead — it is
  correct, load-bearing, and currently never exercised because the files
  carrying it are never opened.
- `sessionKind: "bg"` appears on 5589 records across 15 files, marking
  background sessions. The reference implementation predates it.
- `custom-title` (user-set) now exists alongside `ai-title` (model-set). The
  reference implementation reads only the latter, so a session the author
  deliberately renamed is filed under the model's name instead.

This section is why `probe` is a first-class command (§11.3) rather than a
debugging flag. The right response to drift is to look, not to assume.

## 4. Project discovery

### 4.1 The config file marks the root

The tool walks up from the current directory looking for `.claude-export.yaml`
(or `.claude-export.json`; first match wins). **The directory containing that
file is the project root.** The walk stops at the filesystem root.

This replaces the reference implementation's approach of deriving the root from
the script's own file location, which cannot work for an installed package.

Consequences worth stating:

- The tool works from any subdirectory of the project.
- A project with no config file is an error with a clear message pointing at
  `init` (§11.4), not a guess.
- The resolved root is **always printed** in normal output. A config file in an
  unexpected parent directory silently claiming a nested repo is the one
  failure mode of walk-up discovery, and printing the root is what makes it a
  five-second diagnosis instead of a mystery.

Overrides, in decreasing precedence: command-line flags, `--config <path>`,
`--project <path>` (root without a config), discovered config, defaults.

### 4.2 Matching sessions to the root

A session belongs to the project when its working directory is the project root
or a descendant of it.

The working directory comes from the `cwd` field on `user`, `assistant`,
`attachment`, and `system` records, and from `relocatedCwd` on `relocated`
records. In the observed corpus, every one of the 84 logs carries a `cwd`
within its first 12 records, and it always agrees with the directory name.

**Directory-name decoding is not used for matching.** Claude Code encodes the
project path into a directory name by replacing `/` with `-`
(`/Users/a/p` → `-Users-a-p`). The encoding is lossy and not injective — a path
containing a hyphen is indistinguishable from one containing a separator — so
it can be *generated* but never reliably *parsed*. Reading `cwd` is
authoritative and costs a dozen parsed lines per file.

Descendant matching, rather than equality, handles two real cases:

- Claude Code launched from a subdirectory, which produces a differently-named
  project directory that equality matching would miss entirely.
- Worktrees. The observed `relocated` records point at paths like
  `<project>/.claude/worktrees/<name>`, which are part of the project and
  should be captured with it.

### 4.3 Two-phase read

1. **Identity scan.** For every `~/.claude/projects/*/*.jsonl` — depth one
   exactly, never a recursive walk (§4.4) — parse records until session id and
   working directory are known, capped at 50 records. Decide inclusion.
2. **Full parse.** Only for included sessions. Titles arrive late in a file, so
   there is no shortcut here — but there is no reason to pay it for other
   projects' sessions.

### 4.4 Subagent logs, and why the scan is not recursive

Task-tool subagent transcripts are written to:

```
~/.claude/projects/<project>/<parent-session-id>/subagents/agent-<id>.jsonl
```

— a directory *named for the parent session*, sitting beside the parent's own
`<parent-session-id>.jsonl`. Two exist in the observed corpus; the mechanism
is recent.

**The scan must therefore be depth-one and never recursive.** This was
established by experiment, and it is worth recording what a recursive scan
would have produced, because the failure is quiet rather than loud. Every
record in a subagent log carries:

- `isSidechain: true`
- `cwd` — the project directory, matching §4.2 exactly
- `sessionId` — **the parent's id, not its own**
- `sessionKind` — inherited from the parent

So a recursive scan plus `cwd` matching would have found these files, accepted
them as project sessions, and filed them under a UUID that already belongs to a
real transcript. The result is not an error; it is a second, wrong document
competing with a correct one, under a name that looks authoritative.

Two independent defenses, because one of them is a schema detail that could
drift:

1. The scan is depth-one, so nested directories are never opened.
2. Records with `isSidechain: true` are dropped, wherever they are found.

**Subagent transcripts are not captured** (`subagents: ignore`, the default).
The parent log already records the exchange at the right altitude — the Task
call's prompt as a `tool_use` block and the agent's report as a `tool_result` —
which is the part a reader of the parent session needs. Of the nine records in
the probe's subagent log, only two survive default content policy: the prompt
and the final reply, both already present in the parent.

`subagents: capture` writes them as separate transcripts, named for the agent
id and cross-linked to the parent, for anyone who wants the internals. These
logs are as ephemeral as any other, so the option exists; it is off because the
default should not duplicate content.

*(Claude Code also writes a second copy of subagent traffic under
`/private/tmp/claude-<uid>/…/tasks/*.output`. Out of scope: it is temp-scoped,
and duplicates the `subagents/` log.)*

## 5. Configuration

`.claude-export.yaml`, at the project root. Every key optional.

```yaml
# Where transcripts are written, relative to this file.
out: docs/sessions

# Session UUIDs. Block always wins over allow.
exclude: []
# A non-empty `include` switches to opt-in-only: nothing else is extracted.
include: []

# Content policy.
tools: strip        # strip | summarize | keep
thinking: drop      # drop | keep
images: extract     # extract | marker
imageDir: images    # relative to `out`
subagents: ignore   # ignore | capture
skipEmpty: true     # skip sessions with no surviving prose

# Sessions still being written (see §9.3). Capturing them is the default.
skipActive: false
activeGraceMinutes: 30   # only consulted when skipActive is true

# Opt-in: pair each session with commits authored while it was open.
commits: false

# Index generation.
index:
  enabled: true
  preamble: null      # project-specific prose, inserted verbatim
  listExcluded: count # count | ids | none
```

### 5.1 Selection is by UUID

Session UUID is the only selector. The alternatives were considered and
rejected for the same underlying reason — they are not stable:

- **Title.** Titles are model-generated `ai-title` records that accumulate as a
  session is renamed mid-flight; the parser already has to take "last one
  wins". Matching a glob against a value the model rewrites while you work is
  matching a moving target.
- **Date range.** Useful, but expressible as a set of UUIDs once, and a date
  range silently captures sessions created later.
- **Branch.** `gitBranch` is on the records and is tempting, but a branch is
  reused and renamed.

UUIDs are opaque, which makes §11.2 (`list`) a **required** companion feature
rather than a nicety. A blocklist you cannot populate is not a feature.

### 5.2 Exclusion is visible, and permanent

Two properties, both deliberate:

**Visible.** The index reports how many sessions the config excluded. Silent
omission from a generated record is the failure mode this kind of tool exists
to avoid — a reader cannot audit an absence they cannot see. `listExcluded: ids`
prints the UUIDs too; it is not the default, because "I excluded this session
because it contains a credential" is a case where the id in a committed file is
itself a pointer.

**Permanent.** The logs are a cache. A session excluded today, whose JSONL
Claude Code prunes next month, is unrecoverable. A blocklist is therefore a
permanent decision made with incomplete information, and the docs must say so
in those words. Mitigation: `--ignore-config --out <scratch>` performs a full
capture regardless of config, so "extract everything so I can look" is always
one command away.

## 6. Record handling

| Type | Handling |
| --- | --- |
| `user` | Turn candidate; see §7.2. |
| `assistant` | Turn content, coalesced; see §7.3. |
| `custom-title` | **Title, highest precedence.** Last wins. |
| `ai-title` | Title, if no `custom-title`. Last wins. |
| `agent-name` | Title fallback, if neither of the above. |
| `continued-in` | Records `continuedInSessionId` → frontmatter (§8.1). |
| `relocated` | Contributes `relocatedCwd` to project matching (§4.2). |
| `system` | Metadata only. `compactMetadata` marks a compaction boundary. |
| `attachment` | Identity metadata only; content not rendered. |
| `queue-operation` | Not rendered by default; see below. |
| everything else | Ignored. Counted by `probe`, never rendered. |

Two of these deserve their reasoning recorded.

**`continued-in` is a real link, not a curiosity.** One `continuedInSessionId`
appears in the observed corpus, and it points from one session file to another.
A long piece of work spans multiple session files, and without this the
transcript for the first half simply stops mid-thought with nothing saying
where it went. Both directions belong in the output: the forward link from the
record, and the reverse link computed across the run (§8.1).

**`queue-operation` carries genuine authored prose** — the observed sample is a
message the author typed while the assistant was working
(`"Maybe the shared founding should go in the timeline doc…"`). It is not
rendered by default because a queued message that was later delivered also
appears as a normal `user` record, and rendering both would duplicate it. But a
queued message that was *cancelled* exists nowhere else in the log. Default off,
config-switchable, and flagged in §14.3 as needing a dedupe rule before it can
sensibly be turned on.

### 6.1 Content blocks

| Block | Handling |
| --- | --- |
| `text` | Verbatim. |
| `thinking` | Dropped unless `thinking: keep`. |
| `tool_use` / `tool_result` | Dropped unless `tools: keep`. |
| `image` | Written to a file; see below. |
| unknown | An explicit `> [unhandled block type: x]` marker, never a silent drop. |

`thinking` is dropped by default because exploratory reasoning actively
misleads a later reader: a hypothesis the assistant talked itself out of reads
like a proposal if you find it out of context.

Tool payloads are dropped by default because in Claude Code anything authored
lands in the working tree and is captured by the commit, making the payload
redundant with git while accounting for the bulk of the raw bytes. (This is the
opposite of the right default when reading a claude.ai export, where a generated
document exists nowhere but its `tool_use` payload — which is why that case is
out of scope, §2.)

**Images are written to files, not markers and not data URIs.** All five images
in the observed corpus are base64 PNG/JPEG pasted by the author into a human
turn — 37 KB to 525 KB each, ~1.2 MB in total. They are authored content that
exists nowhere but the log, so the argument for capturing them is the same
argument as §1. A marker loses exactly what the tool is for; a data URI puts
485 KB on one line and destroys the file for reading and diffing.

Each image is written to `<out>/<imageDir>/<id8>-<hash8>.<ext>`, where `hash8`
is the first 8 hex of a SHA-256 over the decoded bytes, and referenced from the
transcript as `![pasted image](images/<name>)`.

Naming by content hash is what keeps §9 intact. Identical bytes always produce
an identical filename, so a rerun rewrites nothing and the same screenshot
pasted twice is stored once. The extension comes from `source.media_type`; an
unrecognized media type falls back to a marker rather than guessing.

`images: marker` renders `> [image: image/png, 474 KB]` instead and writes
nothing — appropriate when the output directory must stay text-only.

## 7. The turn model

This is the load-bearing part of the tool and the part where a wrong choice is
invisible in the output.

### 7.1 Definition

A **turn** is one exchange, not one record. Claude Code spreads a single reply
across many records — text, tool call, result, more text — where a chat message
is one message. The rendered unit is the exchange, because that is what a
citation wants to name.

### 7.2 The human-turn predicate

A `user` record is a human turn when all hold:

1. `type === "user"`
2. not `isMeta`
3. not `isSidechain` (currently always true; see §3.1)
4. its content blocks are not *all* `tool_result`
5. its text is non-empty after harness tags are stripped

Harness tags stripped, with their contents: `local-command-caveat`,
`local-command-stdout`, `command-name`, `command-message`, `command-args`,
`system-reminder`.

**The command name is stripped along with the rest, deliberately.** Keeping it
turns `/clear` into a one-word human turn — something the author never said —
and shifts every turn number after it.

The predicate carries the tool. Without it, 10832 user records become 10832
human turns instead of 778: a transcript inflated fourteenfold, in which the
alternation that makes turn numbers meaningful is destroyed.

### 7.3 Assistant coalescing

Consecutive assistant records join into one turn, separated by blank lines.
Records with no surviving text after content policy contribute nothing.

### 7.4 The cost, stated

Turn numbers are stable only while the filter is stable. A change to §7.2
renumbers every transcript. This is the price of the exchange-level unit and it
is worth paying, but it must be documented where a citer will see it — so the
index says it, in the generated text, every time.

## 8. Output

```
<out>/
  index.md
  2026-08-29--consolidating-the-two-sites--0ba0029e.md
  images/
    0ba0029e-3f9c1a72.png
```

Transcripts are `<created>--<slug>--<id[0:8]>.md`, dates local (§8.2). The
`images/` directory holds extracted image blocks (§6.1) and is absent when
there are none.

### 8.1 Frontmatter

```yaml
title: Consolidating the two sites
session_id: 0ba0029e-a331-4cfa-b9f9-e742bf4f3563
project: /Users/alexgs/projects/alexgs-dev
source: claude-code
created: 2026-08-29
updated: 2026-08-30
turns: 44
extracted: 2026-09-02
kind: bg                  # omitted when absent
continued_in: 01011c01-…  # omitted when absent
continues: b9c837c1-…     # reverse link, computed across the run
commits_in_window:        # only when `commits: true`
  - 65bb587 Initial commit
```

`commits_in_window` means *"committed while this session was open"*, which is
not the same claim as "committed by this session" — a hand-made commit lands
here too, and two concurrent sessions both list the overlap. The window is used
rather than the `Claude-Session` commit trailer because that id appears nowhere
structural in the log: it shows up only inside conversation content, so a
session quoting another session's id offers two candidates and no way to
choose. A window is less precise and does not lie about its precision.

### 8.2 Dates are local

`created`/`updated` are `YYYY-MM-DD` in **local time**, not UTC. A session
beginning 2026-08-25T00:13Z is 17:13 on 2026-08-24 where the author was
sitting, and every other date the surrounding project cites — git commits
above all — is local. Filed by UTC it lands a day after the commit it produced.

### 8.3 The index

Generated, overwritten, and marked as such. Table of created / title / turns /
session id, plus:

- A computed statement about turn alternation. **Computed, not asserted** — the
  claim "odd turns are the author" is exactly the sort of plausible statement
  that turns out to be false once, and checking costs ten lines. It is false
  here: measured against the corpus, 13 alternation breaks across 9 of 74
  sessions, plus one session that opens with an assistant turn.

  Measured as **adjacent same-speaker pairs**, not as index parity. The obvious
  implementation — compare each turn against `index % 2` — inflates wildly,
  because one break early in a long session flips every turn after it. The
  same 13 real breaks report as 172 that way. The number is not so much wrong
  as meaningless, and a generated index is the last place to put one.
- The §7.4 caveat about turn-number stability.
- The exclusion count (§5.2).
- `index.preamble` verbatim, if configured. This is where project-specific
  prose goes; the reference implementation hardcodes a paragraph about a
  validator and a topic index that means nothing to anyone else.

## 9. Idempotence

**A rerun over unchanged logs writes nothing.**

### 9.1 The renderer is pure

`renderSession(session, { extractedOn })` reads no clock and touches no
filesystem. Every input is a parameter. This is what makes the format free —
the reference implementation's date-stabilizing regex constrains the output to
markdown-with-YAML-frontmatter, and this does not.

### 9.2 The extracted date

`extracted:` means **the date this transcript's content last changed**, not the
date the extractor last ran. Keeping a clock value in the output would make
every rerun touch every file, producing a wall of one-line diffs in the one
directory where a real change to an old transcript would matter.

The write path:

1. Read the existing file, if any; recover its `extracted:` value.
2. Render with that date.
3. If the result equals the file on disk byte-for-byte, do nothing.
4. Otherwise render with today's date and write.

Reading the prior date back is a small per-format operation — "this format
knows how to read its own header" — not a regex over arbitrary prose. That
distinction matters: a transcript *body* can easily contain `extracted:` at the
start of a line, and the reference implementation has to defend against exactly
that.

One accepted consequence: improving the parser changes every transcript's
content, so a tool upgrade restamps the whole corpus. That is correct under the
definition above, and it will look dramatic the first time.

### 9.3 Active sessions

**Every session is captured, including one still being written.** A partial
transcript beats no transcript: it self-heals on the next run, and §1's whole
argument is that the log is the copy that forgets. Skipping leaves the
ephemeral copy as the only copy for longer, which is backwards.

This is also what the primary workflow needs. Quitting Claude Code and *then*
running `cctx` from a plain shell means every session on disk is already
finished — so there is nothing to protect against, and a conservative default
would only impose a wait before the session you just did could be captured.

Three things were considered and rejected as the *mechanism*:

- **A terminal record.** There is none. Across the observed corpus the last
  three record types take a dozen different shapes with nothing marking the
  end, so "this session is complete" cannot be derived from the log alone.
- **A grace period** on the last timestamp. Available as `skipActive: true`
  with `activeGraceMinutes`, but wrong as a default: it makes the common case
  — finish a session, capture it, commit — wait half an hour.
- **`CLAUDE_CODE_SESSION_ID`**, which identifies the current session exactly.
  Used when present, since it costs nothing and precisely skips the session
  `cctx` is running inside. But it is absent whenever `cctx` runs from a plain
  shell, which is the primary workflow, so it cannot be load-bearing.

Sessions with recent activity are **reported in stdout**, not flagged in
frontmatter. "In progress" is inherently clock-relative: a frontmatter flag
would flip from `true` to `false` on a later run with no new records,
rewriting the file and bumping `extracted:` — clock-driven churn of exactly
the kind §9 exists to prevent. Keeping it in the run output leaves the
transcript a pure function of the log.

### 9.4 `sessionKind` is not a policy axis

Background sessions (`sessionKind: "bg"`, 15 of the 84 observed files) are
captured on identical terms to interactive ones. They are real work — this
specification was written in one — and they are structurally the same: 13 of
15 carry `ai-title`, as interactive sessions do.

The one difference is `agent-name`, present in 11 of 15 background files
against 6 of 69 interactive ones; it is the job's name, and it serves as the
last title fallback (§6). It rescues one observed background session that has
no `ai-title` at all.

`kind: bg` appears in frontmatter because it is cheap and true. It drives
nothing. What matters is whether a session is still being written, and that
does not correlate with kind: a stalled interactive session in another
terminal is as mid-flight as a running background job.

## 10. Deletion

Four rules, in order of how much they can cost you:

1. **Renames.** A file is deleted when this run wrote a *different* filename
   for the same session id. Titles change, so a session extracted across a
   rename lands under two names; leaving the first produces a truncated
   transcript that reads exactly like evidence, absent from the index, citable
   by anyone who finds it.
2. **Newly excluded.** A session added to `exclude` has its existing transcript
   deleted and reported. Otherwise blocking does nothing to what is already on
   disk, which is the opposite of what the user asked for.
3. **Orphaned images are reported, never deleted.** A file in `<imageDir>`
   that no transcript refers to is listed in the run output, with the command
   to remove it. Content-hash naming makes "unreferenced" an exact fact, so the
   report is trustworthy — but an image is the one output that cannot be
   regenerated once its log is pruned, which puts it on the wrong side of
   rule 4.
4. **Nothing else, ever.** The tool never syncs the output directory to the
   logs. The logs are ephemeral and the output is the durable record: a
   directory sync would delete precisely those transcripts whose JSONL has
   since been pruned and which therefore cannot be regenerated. It would also
   make `--project` on one project destructive to another's output.

Every deletion is printed. A deletion in a generated directory should be
something the author sees in the output as well as the diff.

## 11. CLI

`cctx [command] [flags]`

### 11.1 `extract` (default)

Flags: `--config`, `--project`, `--out`, `--keep-tools`, `--keep-thinking`,
`--no-commits` / `--commits`, `--ignore-config`, `--dry-run`, `--json`.

Output reports: resolved root, sessions captured, written, unchanged, total
turns, skipped (empty / active / excluded), removed (renamed / excluded).

### 11.2 `list`

Every session matching the project, whether or not config includes it: UUID,
date, title, turn count, status (`included`, `excluded`, `empty`, `active`).
This is how a blocklist gets populated (§5.1); it is not optional.

### 11.3 `probe`

Record-type and block-type histograms, human-turn ratio, and any record type
the renderer does not know about. Run this before assuming the parser still
fits — §3.1 is a list of things that changed since the last time someone did.

### 11.4 `init`

Writes a commented `.claude-export.yaml` in the current directory, marking it
as the project root.

Exit codes: `0` success, `1` runtime failure, `2` usage error.

## 12. Library API

The CLI is a thin wrapper. Exported: `findConfig`, `loadConfig`,
`findSessions`, `readSession`, `buildTurns`, `isHumanTurn`, `renderSession`,
`renderIndex`, `extract`, and the `Session` / `SessionTurn` / `RawRecord` /
`Config` types.

Pure functions stay pure and are exported as such; anything touching the
filesystem or the clock is named so that it is obvious which it is.

## 13. Packaging

- Node ≥ 22, ESM only, TypeScript compiled to JS with declarations.
- Runtime dependency: `yaml` (frontmatter out, config in). Nothing else.
- Package and bin name: `cctx`.
- Tests: unit tests over the pure functions, fixture-driven end-to-end runs in
  a temp directory, and a `probe` snapshot over checked-in fixtures so schema
  drift fails a test rather than silently degrading output.

## 14. Open questions

One remains.

**`queue-operation` dedupe.** Turning on §6's queued-prose capture requires a
rule for recognizing that a queued message was later delivered, so the two
copies do not both render. Probably an exact-text match against a subsequent
user record in the same session. Until that rule exists the feature stays off,
and cancelled queued messages — prose that exists nowhere else — stay
uncaptured. That is a known, accepted gap rather than an oversight.

### 14.1 Settled during drafting

| Question | Resolution |
| --- | --- |
| Package and bin name | `cctx` |
| `image` blocks | Extracted to hash-named files (§6.1) |
| `sessionKind: "bg"` | Not a policy axis (§9.4) |
| Active-session handling | Capture everything; grace period opt-in (§9.3) |
| Orphaned images | Reported, never deleted (§10.3) |
| Where subagent traffic lives | Nested `subagents/` dir, `isSidechain: true` (§4.4) |

The last of these was settled by running an experiment rather than reasoning
about it, and it changed the design: the recursive scan this document
originally specified would have silently produced duplicate transcripts filed
under the parent session's UUID. Two of the six above reversed a decision
already written down. That is the argument for §11.3 (`probe`) existing as a
command — the schema is observed, not documented, and the observations were
wrong twice in one afternoon.

## 15. Relationship to the reference implementation

`protocol-era` keeps working through config rather than code: `out:
sources/sessions`, `commits: true`, and its current index prose moved verbatim
into `index.preamble`. Its output changes — `extracted:` semantics are
unchanged, but frontmatter gains fields and the index gains an exclusion line —
which the author has accepted.

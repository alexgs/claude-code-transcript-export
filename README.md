# Claude Code Transcript Export (cctx)

Extract Claude Code session logs into readable, committable markdown transcripts.

Claude Code transcripts exist in exactly one place: JSONL files under
`~/.claude/projects/`, on the machine where the work happened. They are not in
the claude.ai account export and never will be. They are also not durable —
they are a cache, subject to pruning by a tool that does not consider them
precious.

`cctx` moves them from a location that forgets into one that remembers.

## Install

```sh
npm install -g cctx
```

Requires Node 22 or newer.

## Use

From anywhere inside your project:

```sh
cctx init      # write .claude-export.yaml — its location marks the project root
cctx list      # see every session, with its UUID
cctx           # write transcripts
```

Output looks like this:

```
docs/sessions/
  index.md
  2026-08-29--consolidating-the-two-sites--0ba0029e.md
  images/
    0ba0029e-3f9c1a72.png
```

Each transcript carries YAML frontmatter (title, session id, dates, turn count,
links to continued sessions) and the conversation as numbered, speaker-labelled
turns.

### Commands

| | |
| --- | --- |
| `cctx` / `cctx extract` | Write transcripts for this project |
| `cctx list` | Every session with UUID, date, turn count and status |
| `cctx probe` | Report the observed log schema |
| `cctx init` | Write a starter config in the current directory |

Useful flags: `--project <path>` to work outside a configured project,
`--dry-run`, `--json`, `--keep-tools`, `--keep-thinking`, `--ignore-config`.

## How it decides things

**A turn is one exchange, not one record.** A single reply is spread across many
records — text, a tool call, its result, more text. Those coalesce into one
turn, because that is what a citation wants to name. The cost: turn numbers are
stable only while the filter is.

**Most `user` records are not you.** Across the corpus this was built against,
775 of 10,600 `user` records are the human actually speaking — 7.3%. The rest
are tool results the harness feeds back. Treating them all as turns would
inflate a transcript fourteenfold.

**Tool payloads and thinking are dropped by default.** Anything authored in a
Claude Code session lands in your working tree and is captured by the commit, so
the payload is redundant with git while making up most of the bytes. What is
unique to the transcript is the prose. Pass `--keep-tools` if you disagree.

**Images are kept.** Screenshots you paste exist nowhere but the log, so they
are written alongside the transcript, named by a hash of their content.

**Dates are local.** A session beginning `2026-08-25T00:13Z` is 17:13 on
2026-08-24 where you were sitting, and so is the commit it produced.

**A rerun over unchanged logs writes nothing.** `extracted:` means the day a
transcript's content last changed, not the day the tool last ran, so reruns do
not produce a wall of one-line diffs.

**Deletion is narrow.** Renamed and newly-excluded transcripts are removed and
reported. Nothing else, ever — the logs are ephemeral and this output is the
durable copy, so a directory sync would delete precisely the transcripts that
can no longer be regenerated. Orphaned images are reported but never deleted.

## Configuration

`.claude-export.yaml`, at the project root. `cctx init` writes a commented
starter. Every key is optional; see
[the specification](docs/specs/01-initial-specification.md) for the full list.

Sessions are selected by UUID — titles are model-generated and change while you
work, so they are not a stable selector. Run `cctx list` to get the ids.

> A blocklist is permanent. The logs are a cache: a session you exclude today,
> whose log Claude Code prunes next month, is unrecoverable. `cctx
> --ignore-config --out <scratch>` captures everything if you want to look
> first.

## On schema drift

The Claude Code log format is undocumented and it moves. This package was
written against 84 logs on one machine, and during a single afternoon of
drafting, two design decisions had to be reversed by observation.

The test suite guards against *our* regressions. **It cannot detect Claude Code
changing its format**, because CI has no real logs to look at. A green badge
here does not mean the parser still fits your logs.

Detecting that stays a manual act:

```sh
cctx probe
```

It reports every record and block type it sees, and names the ones this version
does not handle. Run it when output looks wrong.

## Library

```ts
import { discover, readSession, renderTranscript } from 'cctx';
```

Everything is pure unless its name says otherwise — nothing below the CLI layer
reads the clock, the environment, or your home directory. See
[the specification](docs/specs/01-initial-specification.md) §12.

## License

MIT

# The library, for other sources

Status: implemented. Amends §2 and §12 of
[01-initial-specification.md](01-initial-specification.md).

## The question

A reader for claude.ai account exports — select conversations by project or
by conversation id, write them as transcripts — was proposed for `cctx`. §2
puts claude.ai exports out of scope. That still holds for the tool: nearly
every rule `cctx` keeps answers a property of Claude Code's logs that an
account export does not share. The depth-one scan and the sidechain filter
(§4.4) keep subagent logs out; project membership by directory name or `cwd`
(§4.2) exists because logs live on a filesystem and projects get renamed;
carrying the index forward (spec 03) and naming sent files by `file_uuid`
(spec 04) exist because the logs and `/tmp` get pruned. An export is one file,
selected from by explicit id, with its own schema. Folding it in would put an
"except for exports" branch in front of each of those rules.

So the reader is a separate program. What it shares with `cctx` is the back
half of the pipeline — turns, markdown, the write-if-changed comparison, the
filename shape, the read-back of transcripts already on disk — and it gets
that by depending on this package.

## What that asked of the library

Almost nothing was missing from the exports. What was wrong was that the
renderer assumed its input came from a Claude Code log:

1. **`renderTranscript`, `frontmatterFor` and `sessionFilename` took a whole
   `Session`**, which requires `cwds` and `rawMessages`. A conversation from an
   export has neither, and a consumer filling them with `[]` and `0` to satisfy
   the type is writing a lie the type asked for. They now take
   `TranscriptSession`, the fields a transcript is actually rendered from. A
   `Session` is one structurally, so no caller changes.
2. **`source: claude-code` was hardcoded.** It is now an option,
   defaulting to `claude-code`, which `cctx` never overrides.
3. **There was no way to record a fact the library does not know about** — a
   project id, a conversation URL. `fields` appends further frontmatter after
   the built-in keys. A key the library already writes is ignored rather than
   overridden: `session_id`, `created`, `turns` and `extracted` are what
   `readExtractedDate` and `parseTranscript` read back, and a consumer able to
   replace them could write transcripts the rest of the library misreads —
   most visibly, a forged `extracted:` would defeat the zero-diff rerun (§9).
4. **`parityStatement` took `Session[]`** and reads only `turns`. It now takes
   anything with turns, for the same reason as (1).
5. **`DEFAULT_CONTENT_POLICY` was exported only as a type's neighbour**, not as
   a value. It is now exported.

`renderIndex` is left as it is. Its prose is about Claude Code sessions —
the heading, the paragraph on stripped tool calls, the sentence about having
no claude.ai URL — and parameterizing every sentence would produce a function
whose output nobody could predict from its call. A consumer writes its own
index from `parityStatement` and its own rows.

## §12, restated

The list in §12 had drifted: `findSessions` and `renderSession` never shipped
under those names. The surface is now whatever `src/index.ts` exports, and
`test/exports.test.ts` lists it, so a name added or removed fails a test and
has to be done on purpose. Other packages build on these names; one
disappearing is a breaking change even when nothing in this repository calls
it.

§12's other claim — that anything touching the filesystem or the clock is
named so it is obvious — was never true (`writeIfChanged`, `readTranscripts`,
`discover` and `extract` all do I/O without saying so) and is withdrawn rather
than enforced by renaming. What holds is the weaker rule in the source
comments: nothing below `cli/` reads the clock, the environment or the home
directory unprompted.

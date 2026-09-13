# Files the assistant sent

Status: implemented. Amends §6.1, §7.2, §8 and §9 of
[01-initial-specification.md](01-initial-specification.md).

## The gap

Claude Code's `SendUserFile` tool puts a file in front of the author — in the
observed case, a scratch render the assistant made in `/tmp` to show what a
change looks like — with a caption saying what to see in it. None of it
reached a transcript:

1. The call's `tool_use` block is stripped by `tools: strip` (§6.1).
2. Its result arrives as a `user` record that is entirely `tool_result`, which
   §7.2 rejects as a human turn, and `buildTurns` never renders a `user`
   record that is not one — under any policy.

So the transcript of a session spent looking at renders reads as an assistant
talking about pictures that are not there. Session `4327b849` in the
`protocol-era` project, which prompted this, sent seven images across five
calls; the transcript carried the three screenshots the author pasted and none
of the seven.

## Why this is not what `tools: strip` is for

The same argument as specification 02. §6.1 drops tool traffic because what it
authors lands in the working tree and the commit captures it. A render written
to `/tmp` never lands anywhere; neither does the caption. Both exist in the log
and the scratch directory, and the scratch directory is cleaned.

## What the log records

The result record's `toolUseResult`:

```json
{
  "caption": "Default (solid), then the same page seeded from tint. The second one is the finding…",
  "attachments": [
    {
      "path": "/tmp/claude-1000/…/scratchpad/paint.png",
      "size": 168385,
      "isImage": true,
      "media_type": "image/png",
      "file_uuid": "89e507b1-aff3-46cf-9106-7ebd937af3e5"
    }
  ]
}
```

Observed, not documented (§3.1). Recognized by an `attachments` list whose
entries name a path. **The bytes are not there.**

They are often elsewhere in the log, though. When the assistant `Read`s an
image to look at it, the result carries the image as a base64 block, and
`toolUseResult.file.originalSize` records the size of the file read. In the
observed session six of the seven sent images had been read first, each at
exactly the size later sent. One had not.

Two properties of those copies shape the design:

- **`Read` downscales.** An image over 2000px on its long edge comes back
  resized and re-encoded — `bench.png` at 1400×3000 was logged at 933×2000 and
  larger in bytes than the file. A copy is the file only when its byte length
  equals the size sent.
- **Scratch files are overwritten.** `stack-crop.png` was read in three
  different versions before one was sent. A copy only counts if it was read
  before the send, and its size has to agree.

## Handling

**Rendered into the assistant turn, whatever `tools` says.** Each file is
listed by path; an image follows its path; the caption comes last:

```markdown
Sent `/tmp/claude-1000/…/scratchpad/paint.png`

![paint.png](images/4327b849-89e507b1.png)

Default (solid), then the same page seeded from tint. The second one is the finding…
```

A file that is not an image is listed by path alone. A failed send leaves an
error string in `toolUseResult` and renders nothing.

**Bytes come from the first of these that has them:**

1. A `Read` of the same path, earlier in the session, whose bytes are exactly
   the size sent.
2. The copy a previous run already wrote to the image directory.
3. The file at its original path, if it is still exactly the size sent.
4. A `Read` of the same path whose `originalSize` matches — the downscaled view
   the assistant had.

When none does, a marker: `> [image: image/png, 318 KB, not in the log or on
disk]`. Under `images: marker`, the ordinary marker, and nothing is read.

The log comes first because it is the only source that is identical on every
machine on every day. The earlier extraction comes before the original so that
a scratch file overwritten after the session — same path, conceivably the same
size — can never replace what was captured. The downscaled copy comes last
because the real file, when it survives, is better.

The filesystem lookups are injected (`SentFileSources`); `extract` supplies
them. Rendering stays pure, and without them a session renders from the log
alone — which is what the test suite and `cctx list` do.

## Naming: by delivery, not by content (amends §6.1, §8)

A sent image is written as `<id8>-<uuid8>.<ext>`, where `uuid8` is the first 8
hex of the attachment's `file_uuid`. Not the content hash §6.1 uses for pasted
images.

A content-hash name can only be found again by someone holding the bytes. The
case this feature exists for is the rerun that does not: `/tmp` has been
cleaned, the log never held the file, and the copy the first run made is the
only one left. With a name derivable from the log alone, that rerun finds the
copy, links it, and the transcript is byte-identical — §9's zero-write rerun
holds. With a content hash it would degrade the link to a marker and rewrite the
transcript, and the image would drop into the orphan report.

When an attachment has no usable `file_uuid`, the name falls back to the content
hash and step 2 is skipped.

## Deletion (§10)

Unchanged, and worth stating: nothing here deletes. A captured image stays
whether or not its original, its log, or the link to it survives, and one no
transcript references is reported as an orphan like any other.

## The cost

§7.4 again, narrowly. The rendered block joins the assistant run being
coalesced, so it splits nothing and adds no human turns. But in a run that was
otherwise all tool traffic — no text at all — it creates an assistant turn
that did not exist, renumbering what follows. Every sent file observed so far
sat beside assistant prose, so no existing transcript is expected to move.

Transcripts of sessions that sent files do change: they gain the block, and
their images.

## What is not addressed

Images the assistant `Read` but did not send. They are what the assistant
looked at, not what it showed the author, and there are many more of them — 82
across ten sessions of the same project, some of them the author's own pasted
screenshots read back. They remain dropped with the rest of the tool traffic.

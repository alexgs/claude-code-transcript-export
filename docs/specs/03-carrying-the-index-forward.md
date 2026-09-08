# Carrying the index forward

Status: implemented. Amends §8.3 and §10 of
[01-initial-specification.md](01-initial-specification.md).

## The gap

Move a project to a new machine — a cloud dev box, a reinstall, a second
laptop — and `~/.claude/projects` there holds only what that machine has done.
The transcripts come across in the repository, because they are committed. The
logs do not, because they were never in it.

Run `cctx` in that state and `index.md` is rewritten down to the sessions the
new machine happens to have. Every earlier row disappears: the transcripts are
still sitting in the same directory, still committed, but nothing lists them.
The measured alternation counts reset with them, so the index goes from
reporting the truth about 74 sessions to reporting it about four.

This is §10.4 — *the logs are ephemeral and the output is the durable record* —
applied everywhere except the one file whose job is to say what the output
contains. The rule that stops a directory sync from deleting an unregenerable
transcript did not stop the index from forgetting it.

## Where the rows come from

Not from a sidecar. The obvious fix is a generated `metadata.json` holding the
stats, merged forward on each run, and it is the wrong one for two reasons.

It cannot recover a row lost before it existed. The rows already gone went with
logs that no longer exist anywhere; a file that starts accumulating today
restores nothing, and the author is left reconstructing an index out of
`git log -p index.md`.

And it is a second source of truth about a file lying next to it. When the
sidecar and the transcript disagree — a hand-deleted file, a partial checkout, a
merge that took one side — something has to arbitrate, and the arbitration
rule is the whole design. Reading the transcript makes disagreement impossible:
absent file, absent row.

Every field the index prints is already in the transcript:

| Column | Read from |
| --- | --- |
| Created | frontmatter `created` |
| Title | frontmatter `title` |
| Turns | frontmatter `turns` |
| Session ID | frontmatter `session_id` |

and the alternation statement's input — the sequence of speakers — is the
`## [N] Human` / `## [N] Assistant` headings the renderer wrote.

## Handling

**Every transcript in the output directory is read before anything is
written.** Read-only, and read first, so it reflects what the previous run left
and a `--dry-run` reports it truthfully.

**A row is carried when no log this run saw can regenerate it.** A transcript
whose session id appears among the sessions discovered this run is dropped from
the carried set — the live session is authoritative, including for a session
that was skipped as active or empty. Config still wins over the disk: an id in
`exclude`, or absent from a non-empty `include`, is dropped too. Otherwise a
session deliberately withheld would reappear in the table the moment its log was
pruned, which is the opposite of what §5.2 promises.

**Carried rows sort in among the rest**, by created date, because the reader is
looking for a session and not for the machine its log happened to be on. The
index says how many rows it could not regenerate, in a sentence that appears
only when there are any.

**Alternation is re-measured from the headings.** Same counting rule as §8.3 —
adjacent same-speaker pairs — over speakers read back rather than speakers
built from records. Measured against this repository's own transcripts, the
index generated with every log deleted is byte-identical to the one generated
from the logs, the carried-forward sentence aside.

**The headings are only believed when they add up.** They must number
themselves 1..n with no gaps, and n must equal the frontmatter's `turns`.
Anything else means something in the body matched — a transcript body is
arbitrary prose, and in a project that documents this tool it is prose that
quotes turn headings. A transcript that fails the check keeps its row, with the
turn count from the frontmatter, and is reported as unmeasured rather than
counted as clean. A fabricated zero would quietly improve a number the index
presents as measured.

**A file that is not a transcript is skipped**, as is one whose frontmatter is
missing, unparseable, or short an identifying field. One hand-edited file must
not take the index down with it.

## Orphaned images, same root cause

§10.3 reports an image in `<imageDir>` that no transcript refers to. "No
transcript" meant "none regenerated this run", so on the new machine every image
belonging to an older session was reported as an orphan — with the command to
delete it — while the transcript pointing at it sat in the same directory. The
one output that cannot be regenerated once its log is pruned, offered up for
deletion because its log had been pruned.

References are now counted from every transcript still on disk after the
pruning of §10.1 and §10.2. After the pruning, so that excluding a session
still surrenders its images to the report: that is the only way the author is
told they are there.

Image links are matched by basename rather than by path, since `renderImage`
hardcodes an `images/` prefix that a configured `imageDir` does not change. An
unrelated link in prose can therefore keep a file off the orphan report. The
error falls on the side of not reporting an orphan, which is the side nothing
is deleted from anyway.

## The cost

The index now reports rows this machine cannot verify. A transcript edited by
hand is believed, because there is nothing left to check it against — which is
already true of the transcript itself, and is the point of §10.4.

Reading every transcript on every run costs one pass over the output directory.
On the corpus this was written against that is 74 files of a few hundred
kilobytes, next to a log scan that is already an order of magnitude larger.

The first run after upgrading rewrites `index.md` on any project whose logs
have been pruned — which is the intended effect, and is exactly the diff the
author wants to see.

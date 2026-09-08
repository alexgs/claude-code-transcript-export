# Answered question widgets

Status: implemented. Amends §6, §6.1 and §7.2 of
[01-initial-specification.md](01-initial-specification.md).

## The gap

Claude Code's `AskUserQuestion` tool renders a widget: the assistant poses one
or more multiple-choice questions, and the author picks an option, types their
own answer into "Other", or adds free-text notes alongside a selection.

None of it reached a transcript. Two independent rules dropped it:

1. The assistant's `tool_use` block, which carries the questions and the
   options, is stripped by the default `tools: strip` policy (§6.1).
2. The author's answer arrives as a `user` record whose content is *entirely*
   `tool_result`, which §7.2 rule 4 rejects before content policy is ever
   consulted.

So a session where a decision was made through the widget renders as an
assistant turn that trails off and a following turn that proceeds on a choice
the transcript never records. Not a formatting loss — the decision itself is
missing.

## Why this is not what `tools: strip` is for

§6.1 drops tool payloads on a specific argument: in Claude Code anything
authored through a tool lands in the working tree, so the payload is redundant
with git while accounting for the bulk of the raw bytes.

That argument does not reach the widget. Nothing in an answer is written to the
working tree. Measured over the corpus this was written against — 100 log files,
27 widget calls, 23 of them answered, 66 individual answers:

- **10 of 66 answers are free text**, typed into "Other" and matching no
  option label. They are ordinary prose — *"I thought we'd just keep it as a
  manual step I did at the end of the conversation. That's worked just fine for
  the last couple of convos."*
- **5 widgets carry `annotations.notes`**, further prose typed alongside a
  selection.

That prose exists in exactly one place: the log. Which is §1's argument, and
the same one that puts images in files rather than markers.

## Where the answer is recorded

Not in the `tool_result` block, which holds only a flattened English sentence.
The structured payload hangs off the record as a top-level `toolUseResult`:

```json
{
  "questions": [{ "question": "…", "header": "…", "options": [{ "label": "…", "description": "…" }] }],
  "answers": { "<question text>": "<chosen label, or the author's own prose>" },
  "annotations": { "<question text>": { "notes": "…", "preview": "…" } }
}
```

Observed, not documented — §3.1 applies here as everywhere. Recognition
requires both a `questions` array and an `answers` object; anything else is an
ordinary tool result.

`answers` is keyed by the question's text and is the sole source of what the
transcript prints. A multi-select answer arrives already comma-joined into one
string, so no list handling is needed to read the corpus; the renderer joins a
list anyway rather than trusting that.

## Handling

**An answered widget is a human turn.** §7.2 gains an exception ahead of rule 4:
a `user` record carrying an answered widget is the author speaking, whatever its
blocks say. The turn splits the assistant's coalesced run in two, which is what
happened — the assistant stopped and waited.

**A dismissed or rejected widget is not.** Escaping the widget to type something
instead leaves `toolUseResult` as an error string, and the prose the author
typed arrives as an ordinary `user` record immediately after. Rendering the
dismissal would add a turn saying nothing. Four of the 27 calls are this case.

**Rendered: the question, the answer, and the notes.** In that order, per
question, with notes as a blockquote:

```markdown
## [13] Human

**How should the new playtest's fixtures be named?**

Prefix with playtest short-id

> Don't you think it would be better to use `5c34991b` instead of `pt5c34991b`?
```

**Not rendered: the options not taken, and `annotations.preview`.** Both are
assistant prose, and the turns either side of the widget generally restate
whatever mattered about them. The option descriptions are also long — one call
in the corpus runs past 3,000 characters of rejected options.

**The block replaces the record's `tool_result` rather than joining it.** Under
`tools: keep` the raw payload would otherwise repeat every question and answer
a second time as JSON.

## The cost

§7.4 comes due. Turn numbers shift in every session containing an answered
widget — 18 of the 100 files in the corpus this was measured against — so
existing citations into those transcripts move by one per widget. This is the
first change to §7.2 since it was written, and it is the kind §7.4 was written
to warn about. Accepted: a stable wrong number is worse than a corrected one,
and the transcripts are regenerated from the logs anyway.

## What is not addressed

The questions themselves still vanish when the widget goes unanswered, and the
option descriptions vanish always. Both are assistant prose and fall under the
same `tools: strip` rationale as the rest of the tool traffic; `tools: keep`
renders them as raw JSON, which is what that policy is for.

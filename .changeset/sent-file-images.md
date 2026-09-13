---
'@alexgsdev/claude-code-transcript-export': patch
---

Render files the assistant sent with `SendUserFile` — path, image and caption —
into the assistant's turn (spec 04). Image bytes come from an earlier `Read` in
the log, a copy a previous run extracted, or the original file when it is still
on disk, so a rerun after `/tmp` is cleaned keeps the image and writes nothing.

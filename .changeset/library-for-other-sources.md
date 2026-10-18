---
'@alexgsdev/claude-code-transcript-export': minor
---

Make the library usable by readers of other conversation sources. `renderTranscript`, `frontmatterFor` and `sessionFilename` now accept a `TranscriptSession` (the fields a transcript is rendered from) instead of a full `Session`, and `parityStatement` accepts anything with `turns`; `RenderTranscriptOptions` gains `source` (default `claude-code`) and `fields`, which appends extra frontmatter without overriding built-in keys; and `DEFAULT_CONTENT_POLICY` is exported. The README now documents the library. `cctx` output is unchanged.

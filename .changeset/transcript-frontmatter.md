---
'@alexgsdev/claude-code-transcript-export': minor
---

`parseTranscript` and `readTranscripts` now return each transcript's whole frontmatter as `CarriedTranscript.frontmatter`, including fields a consumer added through `renderTranscript`'s `fields` option, so carried-forward index rows can show them. The `carried` rows in `cctx extract --json` output include it too.

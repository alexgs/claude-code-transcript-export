---
'@alexgsdev/claude-code-transcript-export': minor
---

The config file is now `.cctx.yaml` (or `.cctx.json`), and `cctx init` writes that name. `.claude-export.yaml` and `.claude-export.json` are still read, with a warning on stderr giving the command to rename the file. A legacy file left beside a new one is reported as ignored, and `cctx init` refuses when a config exists under either name.

---
'@alexgsdev/claude-code-transcript-export': patch
---

`--config <path>` now reads the file it names. It used to search upward from that file's directory and load the first standard config it found, so `--config ./other.yaml` silently read `.cctx.yaml` beside it, or one in a parent directory. The new `loadConfigFile` export does the same for library callers.

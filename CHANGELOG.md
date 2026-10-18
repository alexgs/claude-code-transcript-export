# Changelog

## 0.2.0

### Minor Changes

- ab6dbff: The config file is now `.cctx.yaml` (or `.cctx.json`), and `cctx init` writes that name. `.claude-export.yaml` and `.claude-export.json` are still read, with a warning on stderr giving the command to rename the file. A legacy file left beside a new one is reported as ignored, and `cctx init` refuses when a config exists under either name.
- f489310: Make the library usable by readers of other conversation sources. `renderTranscript`, `frontmatterFor` and `sessionFilename` now accept a `TranscriptSession` (the fields a transcript is rendered from) instead of a full `Session`, and `parityStatement` accepts anything with `turns`; `RenderTranscriptOptions` gains `source` (default `claude-code`) and `fields`, which appends extra frontmatter without overriding built-in keys; and `DEFAULT_CONTENT_POLICY` is exported. The README now documents the library. `cctx` output is unchanged.
- fe04f8d: `parseTranscript` and `readTranscripts` now return each transcript's whole frontmatter as `CarriedTranscript.frontmatter`, including fields a consumer added through `renderTranscript`'s `fields` option, so carried-forward index rows can show them. The `carried` rows in `cctx extract --json` output include it too.

### Patch Changes

- ca7e34e: `--config <path>` now reads the file it names. It used to search upward from that file's directory and load the first standard config it found, so `--config ./other.yaml` silently read `.cctx.yaml` beside it, or one in a parent directory. The new `loadConfigFile` export does the same for library callers.

## 0.1.9

### Patch Changes

- 3a17de0: Render files the assistant sent with `SendUserFile` — path, image
  and caption — into the assistant's turn (spec 04). Image bytes come from an
  earlier `Read` in the log, a copy a previous run extracted, or the original
  file when it is still on disk, so a rerun after `/tmp` is cleaned keeps the
  image and writes nothing.

## 0.1.8

### Patch Changes

- Keep `index.md` rows for sessions whose logs this machine no longer has. The
  index is now rebuilt from the transcripts on disk as well as from the logs,
  so running on a new machine no longer shrinks it (spec 03).
- Count image references from the transcripts on disk rather than from the
  current run, so older sessions' images are no longer reported as orphans.

## 0.1.7

### Patch Changes

- Render an answered question widget as a human turn (spec 02).

## 0.1.6

### Patch Changes

- Version bump only; no changes to the package.

## 0.1.5

### Patch Changes

- Correct the package name in the README.

## 0.1.4

### Patch Changes

- Match logs by their project directory as well as by recorded `cwd`, so
  sessions from before a project rename are found again.

## 0.1.3

### Patch Changes

- `--version` reads the version from `package.json` instead of a hardcoded
  string.

## 0.1.2

### Patch Changes

- Fixes to the release workflow; no changes to the package.

## 0.1.1

### Patch Changes

- Publish under the `@alexgsdev` scope.
- Fix the `cctx` bin path.
- Add the repository metadata npm provenance requires.

## 0.1.0

### Minor Changes

- Initial release.

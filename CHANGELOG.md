# Changelog

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

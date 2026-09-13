# Changesets

Each `.md` file here describes one unreleased change and the semver bump it
calls for. `npm run changeset` writes one; `npm run release:version` consumes
them all, bumps `package.json`, and prepends the entries to `CHANGELOG.md`.

The release process is in `CLAUDE.md` under Releases. The tool's own
documentation is at https://changesets.dev.

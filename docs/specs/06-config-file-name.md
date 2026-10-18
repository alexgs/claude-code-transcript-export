# The config file's name

Status: implemented. Amends §4.1, §5 and §11.4 of
[01-initial-specification.md](01-initial-specification.md).

## The change

The config file is `.cctx.yaml` (or `.cctx.json`), named after the command
rather than after a description of it. `cctx init` writes `.cctx.yaml`.

`.claude-export.yaml` and `.claude-export.json` are still read, and every run
that reads one prints a warning on stderr naming the file and the `mv` that
renames it. There is no date on which they stop being read; that would be its
own decision.

## Precedence

Within one directory the current names win over the legacy ones, and `.yaml`
over `.json` as before: `.cctx.yaml`, `.cctx.json`, `.claude-export.yaml`,
`.claude-export.json`.

**Across directories nothing changes: the nearest directory with any config
wins, whatever it is called.** The tempting alternative — look for a current
name all the way up, then fall back to legacy names — would let renaming the
config in one repository move the project root of another repository nested
inside it, which still has a legacy file. §4.1 calls a config in an unexpected
parent claiming a nested repo the one failure mode of walk-up discovery; a
rename should not be a way to trigger it.

## Two files in one directory

When a current and a legacy file sit side by side, the legacy one is ignored —
and that is warned about too, not just the legacy name. Its `exclude` list
might be the one the author believes is in force, and §5.2 makes a silently
ignored exclusion the costly kind of mistake.

For the same reason, `cctx init` refuses when a config exists in the current
directory under *either* name. Writing a fresh `.cctx.yaml` beside a
`.claude-export.yaml` would replace the latter's settings with defaults without
a word.

## Where the warning comes from

`loadConfig` returns the warnings on `ResolvedConfig.warnings` and the CLI
prints them, because nothing below `cli/` owns a stream. They go to stderr, so
`--json` output stays parseable. `configNameWarnings` computes them and is
exported for any other caller of `loadConfig` that prints its own output.

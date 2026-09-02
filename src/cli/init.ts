export const TEMPLATE = `# cctx configuration. This file's location marks the project root.

# Where transcripts are written, relative to this file.
out: docs/sessions

# Session UUIDs. Block always wins over allow, and a non-empty \`include\`
# switches to opt-in-only. Run \`cctx list\` to see the ids.
#
# Note: the logs are a cache Claude Code prunes. A session excluded here whose
# log is later pruned is gone permanently.
exclude: []
include: []

# Content policy.
tools: strip # strip | keep
thinking: drop # drop | keep
images: extract # extract | marker
imageDir: images
subagents: ignore # ignore | capture
skipEmpty: true

# Sessions still being written are captured by default; a partial transcript
# beats no transcript and self-heals on the next run.
skipActive: false
activeGraceMinutes: 30

# Pair each session with commits authored while it was open.
commits: false

index:
  enabled: true
  preamble: null # project-specific prose, inserted verbatim
  listExcluded: count # count | ids | none
`;

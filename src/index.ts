/**
 * cctx — extract Claude Code session logs into markdown transcripts.
 *
 * Library entry point. See `docs/specs/01-initial-specification.md` §12.
 *
 * Everything exported here is pure unless its name says otherwise: nothing
 * below the CLI layer reads the clock, the environment, or the home directory.
 * Where a function needs one of those, it takes it as a parameter.
 */

export { defaultLogRoot, encodeProjectDir, isWithin } from './paths.js';

export {
  CONFIG_NAMES,
  DEFAULT_CONFIG,
  UsageError,
  contentPolicy,
  findConfig,
  loadConfig,
  mergeConfig,
  parseConfigFile,
  type Config,
  type IndexConfig,
  type ResolvedConfig,
} from './config.js';

export {
  belongsToProject,
  discover,
  listLogFiles,
  parseRecords,
  readIdentity,
  readLogFile,
  type DiscoveredLog,
  type LogIdentity,
} from './discover.js';

export {
  fence,
  recordText,
  renderBlock,
  renderImage,
  slugify,
  stripHarnessTags,
  type RenderContext,
} from './content.js';

export {
  aggregateParity,
  buildTurns,
  isHumanTurn,
  parityReport,
  type ParityReport,
} from './turns.js';

export { resolveTitle, toLocalDate } from './titles.js';

export {
  fallbackIdFor,
  linkContinuations,
  readSession,
  sessionFilename,
  type ReadSessionOptions,
} from './session.js';

export { commitsInWindow, readCommits, type Commit } from './commits.js';

export {
  parseTranscript,
  readImageLinks,
  readTranscripts,
  readTurnHeadings,
  type CarriedTranscript,
} from './carry.js';

export {
  frontmatterFor,
  readExtractedDate,
  renderTranscript,
  type RenderTranscriptOptions,
} from './render/transcript.js';

export {
  parityStatement,
  renderIndex,
  type RenderIndexOptions,
} from './render/index.js';

export {
  findOrphanImages,
  pruneExcluded,
  pruneRenamed,
  writeIfChanged,
  writeImages,
  writePlainIfChanged,
} from './write.js';

export {
  ImageReads,
  renderSentFiles,
  sentFiles,
  type SentAttachment,
  type SentFiles,
} from './sent.js';

export {
  extract,
  fileSources,
  readSessions,
  type ExtractOptions,
  type ExtractSummary,
  type SkipReason,
  type SkippedSession,
} from './extract.js';

export { formatProbe, probe, probeRecords, type ProbeReport } from './cli/probe.js';

export type {
  ContentPolicy,
  ImagePolicy,
  RawBlock,
  RawRecord,
  SentFileSources,
  Session,
  SessionImage,
  SessionTurn,
  Speaker,
  ThinkingPolicy,
  ToolPolicy,
} from './types.js';

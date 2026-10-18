import { describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

/**
 * The library's runtime surface, as a list.
 *
 * Other packages build on these names (specification 05), so one disappearing
 * is a breaking change even when nothing in this repository calls it. This
 * fails on any addition or removal; update the list deliberately, with a
 * changeset that says which it was.
 */
describe('library exports', () => {
  it('match the published surface', () => {
    expect(Object.keys(library).sort()).toMatchInlineSnapshot(`
      [
        "CONFIG_NAMES",
        "DEFAULT_CONFIG",
        "DEFAULT_CONTENT_POLICY",
        "ImageReads",
        "LEGACY_CONFIG_NAMES",
        "UsageError",
        "aggregateParity",
        "belongsToProject",
        "buildTurns",
        "commitsInWindow",
        "configNameWarnings",
        "contentPolicy",
        "defaultLogRoot",
        "discover",
        "encodeProjectDir",
        "extract",
        "fallbackIdFor",
        "fence",
        "fileSources",
        "findConfig",
        "findOrphanImages",
        "formatProbe",
        "frontmatterFor",
        "isHumanTurn",
        "isWithin",
        "linkContinuations",
        "listLogFiles",
        "loadConfig",
        "loadConfigFile",
        "mergeConfig",
        "parityReport",
        "parityStatement",
        "parseConfigFile",
        "parseRecords",
        "parseTranscript",
        "probe",
        "probeRecords",
        "pruneExcluded",
        "pruneRenamed",
        "readCommits",
        "readExtractedDate",
        "readIdentity",
        "readImageLinks",
        "readLogFile",
        "readSession",
        "readSessions",
        "readTranscripts",
        "readTurnHeadings",
        "recordText",
        "renderBlock",
        "renderImage",
        "renderIndex",
        "renderSentFiles",
        "renderTranscript",
        "resolveTitle",
        "sentFiles",
        "sessionFilename",
        "slugify",
        "stripHarnessTags",
        "toLocalDate",
        "writeIfChanged",
        "writeImages",
        "writePlainIfChanged",
      ]
    `);
  });
});

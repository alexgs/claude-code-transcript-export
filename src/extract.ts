import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { readTranscripts, type CarriedTranscript } from './carry.js';
import { readCommits, commitsInWindow, type Commit } from './commits.js';
import { contentPolicy, type Config } from './config.js';
import { slugify } from './content.js';
import { discover, type DiscoveredLog } from './discover.js';
import { renderIndex } from './render/index.js';
import { renderTranscript } from './render/transcript.js';
import {
  fallbackIdFor,
  linkContinuations,
  readSession,
  sessionFilename,
} from './session.js';
import type { SentFileSources, Session } from './types.js';
import {
  findOrphanImages,
  pruneExcluded,
  pruneRenamed,
  writeIfChanged,
  writeImages,
  writePlainIfChanged,
} from './write.js';

/** Why a session was not written. */
export type SkipReason = 'empty' | 'excluded' | 'not-included' | 'active';

export interface SkippedSession {
  id: string;
  title: string;
  reason: SkipReason;
}

export interface ExtractSummary {
  root: string;
  outDir: string;
  sessions: number;
  written: number;
  unchanged: number;
  turns: number;
  imagesWritten: string[];
  skipped: SkippedSession[];
  /** Transcripts deleted, with the rule that removed them. */
  removed: { name: string; reason: 'renamed' | 'excluded' }[];
  /**
   * Index rows read back from transcripts on disk, because no log on this
   * machine can regenerate them. See `carry.ts`.
   */
  carried: CarriedTranscript[];
  /** Reported only; never deleted. */
  orphanImages: string[];
}

export interface ExtractOptions {
  root: string;
  logRoot: string;
  config: Config;
  /** `YYYY-MM-DD`. Injected so the caller owns the only clock read. */
  today: string;
  /** Skip this session id — the one cctx is running inside, when known. */
  currentSessionId?: string;
  /** Milliseconds since the epoch, for the active-session grace window. */
  now?: number;
  dryRun?: boolean;
  /** Overrides the git lookup; tests pass a fixed list instead of shelling out. */
  commits?: Commit[];
}

/** True when a session's last record is inside the grace window. */
function isActive(session: Session, now: number, graceMinutes: number): boolean {
  if (session.endedAt === undefined) return false;
  const end = Date.parse(session.endedAt);
  if (Number.isNaN(end)) return false;
  return now - end < graceMinutes * 60_000;
}

/** Decides whether a session is written, and records why not. */
function selectionReason(session: Session, options: ExtractOptions): SkipReason | null {
  const { config } = options;

  if (config.exclude.includes(session.id)) return 'excluded';
  if (config.include.length > 0 && !config.include.includes(session.id)) {
    return 'not-included';
  }
  if (config.skipEmpty && session.turns.length === 0) return 'empty';
  if (session.id === options.currentSessionId) return 'active';
  if (
    config.skipActive &&
    isActive(session, options.now ?? Date.now(), config.activeGraceMinutes)
  ) {
    return 'active';
  }
  return null;
}

/** A regular file's bytes when it is exactly `size` long, else undefined. */
function readSized(path: string, size?: number): Buffer | undefined {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || (size !== undefined && stat.size !== size)) return undefined;
    return readFileSync(path);
  } catch {
    return undefined;
  }
}

/**
 * Where a sent image is looked for when the log lacks it: the image directory
 * a previous run wrote to, then the path it was sent from.
 *
 * Both are read-only. An original that is gone or has changed size is simply
 * not found, and whatever an earlier run extracted stays where it is.
 */
export function fileSources(imageDir: string): SentFileSources {
  return {
    readExtracted: (filename) => readSized(join(imageDir, basename(filename))),
    readOriginal: (path, size) =>
      isAbsolute(path) ? readSized(path, size) : undefined,
  };
}

/** Reads every log belonging to the project into sessions, links included. */
export function readSessions(
  logs: DiscoveredLog[],
  config: Config,
  sources?: SentFileSources,
): Session[] {
  const policy = contentPolicy(config);
  const sessions = logs.map((log) =>
    readSession(log.records, { policy, fallbackId: fallbackIdFor(log.path), sources }),
  );
  linkContinuations(sessions);
  sessions.sort((a, b) => `${a.created}${a.id}`.localeCompare(`${b.created}${b.id}`));
  return sessions;
}

/** The whole run. */
export function extract(options: ExtractOptions): ExtractSummary {
  const { config, root } = options;
  const outDir = resolve(root, config.out);
  const imageDir = join(outDir, config.imageDir);

  const sessions = readSessions(
    discover(options.logRoot, root),
    config,
    fileSources(imageDir),
  );

  const selected: Session[] = [];
  const skipped: SkippedSession[] = [];
  for (const session of sessions) {
    const reason = selectionReason(session, options);
    if (reason === null) selected.push(session);
    else skipped.push({ id: session.id, title: session.title, reason });
  }

  const summary: ExtractSummary = {
    root,
    outDir,
    sessions: selected.length,
    written: 0,
    unchanged: 0,
    turns: selected.reduce((n, s) => n + s.turns.length, 0),
    imagesWritten: [],
    skipped,
    removed: [],
    carried: [],
    orphanImages: [],
  };

  // Read before anything is written, so this is the state the previous run left
  // and a dry run reports it truthfully. Files this run is about to rewrite,
  // rename away or delete are filtered out by id below; what is left is the
  // transcripts whose logs are gone.
  const onDisk = readTranscripts(outDir);
  const regenerated = new Set(sessions.map((s) => s.id));
  summary.carried = onDisk.filter((t) => {
    if (regenerated.has(t.id)) return false;
    if (config.exclude.includes(t.id)) return false;
    // A non-empty `include` is opt-in-only, and that has to hold for a row the
    // index carries as much as for one it regenerates: otherwise a session
    // deliberately left out reappears in the table the moment its log is gone.
    if (config.include.length > 0 && !config.include.includes(t.id)) return false;
    return true;
  });

  if (options.dryRun === true) return summary;

  mkdirSync(outDir, { recursive: true });

  const commits = options.commits ?? (config.commits ? readCommits(root) : []);

  // Every name this run produced, whether or not the bytes needed rewriting: a
  // file skipped as unchanged is still a file this run stands behind, and
  // pruneRenamed must not treat it as a superseded name.
  const names: string[] = [];
  const referencedImages = new Set<string>();

  for (const session of selected) {
    const name = sessionFilename(session, slugify);
    const wrote = writeIfChanged(
      join(outDir, name),
      (extractedOn) =>
        renderTranscript(session, {
          extractedOn,
          project: root,
          commits: commitsInWindow(commits, session),
        }),
      options.today,
    );

    if (wrote) summary.written += 1;
    else summary.unchanged += 1;
    names.push(name);

    summary.imagesWritten.push(...writeImages(imageDir, session.images));
    for (const image of session.images) referencedImages.add(image.filename);
  }

  if (config.index.enabled) {
    const excluded = skipped
      .filter((s) => s.reason === 'excluded' || s.reason === 'not-included')
      .map((s) => s.id);
    const indexPath = join(outDir, 'index.md');
    const wrote = writePlainIfChanged(
      indexPath,
      renderIndex(selected, {
        preamble: config.index.preamble,
        excluded,
        listExcluded: config.index.listExcluded,
        carried: summary.carried,
      }),
    );
    if (wrote) summary.written += 1;
    else summary.unchanged += 1;
    names.push(basename(indexPath));
  }

  // After the writes, so a name this run produced is never a deletion
  // candidate.
  for (const name of pruneRenamed(outDir, names)) {
    summary.removed.push({ name, reason: 'renamed' });
  }
  for (const name of pruneExcluded(outDir, config.exclude)) {
    if (!summary.removed.some((r) => r.name === name)) {
      summary.removed.push({ name, reason: 'excluded' });
    }
  }

  // Images a transcript still on disk links to are referenced, whether or not a
  // log for it survives. Without this, moving a project to a new machine
  // reports every image from every older session as an orphan — with the
  // command to delete it — while the transcript pointing at it sits right
  // there. Counted after the pruning above, so a transcript this run deleted
  // stops holding its images: excluding a session should surrender them to the
  // orphan report, which is the only way the author is told they are there.
  const removedNames = new Set(summary.removed.map((r) => r.name));
  for (const transcript of onDisk) {
    if (removedNames.has(transcript.filename)) continue;
    for (const image of transcript.images) referencedImages.add(image);
  }

  summary.orphanImages = findOrphanImages(imageDir, referencedImages);

  return summary;
}

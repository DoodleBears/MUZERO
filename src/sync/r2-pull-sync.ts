import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { SyncRun } from "@/db/types";
import { newId } from "@/lib/id";
import { cacheRemoteTrackMedia, type SyncCacheFetch } from "./r2-cache";
import { importRemoteSetStream } from "./r2-import-stream";
import { type DiffRemoteSetInput, diffRemoteSet, type RemoteSetDiff } from "./r2-pull-diff";

export interface RemoteSetPullPreview extends RemoteSetDiff {
  willMutate: boolean;
  trackCount: number;
  bytes: number;
}

export interface ApplyRemoteSetPullResult extends RemoteSetPullPreview {
  runId: string;
  sessionId?: string;
  trackIds: string[];
  cachedMedia: number;
}

export interface ApplyRemoteSetPullInput extends DiffRemoteSetInput {
  cacheMedia?: {
    fetcher?: SyncCacheFetch;
  };
}

export async function dryRunRemoteSetPull(
  input: DiffRemoteSetInput,
  db: MuzeroDB = defaultDb,
): Promise<RemoteSetPullPreview> {
  const diff = await diffRemoteSet(input, db);
  return {
    ...diff,
    willMutate: diff.action === "create-set" || diff.action === "apply-remote",
    trackCount: input.remoteSet.tracks.length,
    bytes: input.remoteSet.index.tracks.reduce((sum, track) => sum + track.media.bytes, 0),
  };
}

export async function applyRemoteSetPull(
  input: ApplyRemoteSetPullInput,
  db: MuzeroDB = defaultDb,
): Promise<ApplyRemoteSetPullResult> {
  const preview = await dryRunRemoteSetPull(input, db);
  const run = await createPullRun(input.driveId, preview, db);

  if (preview.action === "blocked") {
    await failPullRun(run, `${preview.reason ?? "blocked"}`, db);
    throw new Error(`Pull blocked: ${preview.reason ?? "blocked"}`);
  }
  if (preview.action === "conflict") {
    await failPullRun(run, "conflict", db);
    throw new Error("Pull blocked: conflict");
  }
  if (!preview.willMutate) {
    await completePullRun(run, 0, 0, db);
    return { ...preview, runId: run.id, trackIds: [], cachedMedia: 0 };
  }

  try {
    const imported = await importRemoteSetStream(
      {
        driveId: input.driveId,
        remoteSet: input.remoteSet,
      },
      db,
    );
    const cachedMedia = await cacheImportedMedia(input, imported.trackIds, db);
    await completePullRun(run, preview.bytes, input.remoteSet.tracks.length, db);
    return {
      ...preview,
      runId: run.id,
      sessionId: imported.sessionId,
      trackIds: imported.trackIds,
      cachedMedia,
    };
  } catch (error) {
    await failPullRun(run, error instanceof Error ? error.message : String(error), db);
    throw error;
  }
}

async function cacheImportedMedia(
  input: ApplyRemoteSetPullInput,
  trackIds: string[],
  db: MuzeroDB,
): Promise<number> {
  if (!input.cacheMedia) return 0;
  let cached = 0;
  for (const trackId of trackIds) {
    await cacheRemoteTrackMedia(trackId, { fetcher: input.cacheMedia.fetcher }, db);
    cached += 1;
  }
  return cached;
}

async function createPullRun(
  driveId: string,
  preview: RemoteSetPullPreview,
  db: MuzeroDB,
): Promise<SyncRun> {
  const run: SyncRun = {
    id: newId("run"),
    driveId,
    direction: "pull",
    status: "running",
    startedAt: Date.now(),
    totalBytes: preview.bytes,
    bytesDone: 0,
    objectCount: preview.trackCount + 1,
    uploaded: 0,
    skipped: 0,
    failed: 0,
  };
  await db.syncRuns.put(run);
  return run;
}

async function completePullRun(
  run: SyncRun,
  bytesDone: number,
  objectCount: number,
  db: MuzeroDB,
): Promise<void> {
  await db.syncRuns.put({
    ...run,
    status: "completed",
    finishedAt: Date.now(),
    bytesDone,
    objectCount,
  });
}

async function failPullRun(run: SyncRun, error: string, db: MuzeroDB): Promise<void> {
  await db.syncRuns.put({
    ...run,
    status: "failed",
    finishedAt: Date.now(),
    failed: 1,
    error,
  });
}

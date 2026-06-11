import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { CloudSourceAttribution, SyncRun } from "@/db/types";
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
  /** Optional media downloads that failed; the import itself still succeeded (F7). */
  cacheFailures: number;
}

export interface ApplyRemoteSetPullInput extends DiffRemoteSetInput {
  source?: CloudSourceAttribution;
  cacheMedia?: {
    fetcher?: SyncCacheFetch;
  };
  /** Abort the apply — checked before mutating and between media downloads (F6). */
  signal?: AbortSignal;
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
    return { ...preview, runId: run.id, trackIds: [], cachedMedia: 0, cacheFailures: 0 };
  }

  try {
    throwIfPullAborted(input.signal);
    const imported = await importRemoteSetStream(
      {
        driveId: input.driveId,
        remoteSet: input.remoteSet,
        source: input.source,
      },
      db,
    );
    const cache = await cacheImportedMedia(input, imported.trackIds, db);
    await completePullRun(run, preview.bytes, input.remoteSet.tracks.length, db, cache.failures);
    return {
      ...preview,
      runId: run.id,
      sessionId: imported.sessionId,
      trackIds: imported.trackIds,
      cachedMedia: cache.cached,
      cacheFailures: cache.failures,
    };
  } catch (error) {
    await failPullRun(
      run,
      error instanceof Error ? error.message : String(error),
      db,
      input.signal?.aborted ? "cancelled" : "failed",
    );
    throw error;
  }
}

function throwIfPullAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("R2 pull was cancelled.", "AbortError");
}

async function cacheImportedMedia(
  input: ApplyRemoteSetPullInput,
  trackIds: string[],
  db: MuzeroDB,
): Promise<{ cached: number; failures: number }> {
  if (!input.cacheMedia) return { cached: 0, failures: 0 };
  let cached = 0;
  let failures = 0;
  for (const trackId of trackIds) {
    throwIfPullAborted(input.signal);
    try {
      await cacheRemoteTrackMedia(
        trackId,
        { fetcher: input.cacheMedia.fetcher, signal: input.signal },
        db,
      );
      cached += 1;
    } catch (error) {
      // Caching is optional — the imported set still streams. Keep going and
      // report the failure count instead of failing the whole pull (F7).
      if ((error as { name?: string } | null)?.name === "AbortError") throw error;
      failures += 1;
    }
  }
  return { cached, failures };
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
  failed = 0,
): Promise<void> {
  await db.syncRuns.put({
    ...run,
    status: "completed",
    finishedAt: Date.now(),
    bytesDone,
    objectCount,
    failed,
  });
}

async function failPullRun(
  run: SyncRun,
  error: string,
  db: MuzeroDB,
  status: "failed" | "cancelled" = "failed",
): Promise<void> {
  await db.syncRuns.put({
    ...run,
    status,
    finishedAt: Date.now(),
    failed: 1,
    error,
  });
}

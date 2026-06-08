import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { SyncRun } from "@/db/types";
import { newId } from "@/lib/id";
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
  input: DiffRemoteSetInput,
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
    return { ...preview, runId: run.id, trackIds: [] };
  }

  try {
    const imported = await importRemoteSetStream(
      {
        driveId: input.driveId,
        remoteSet: input.remoteSet,
      },
      db,
    );
    await completePullRun(run, preview.bytes, input.remoteSet.tracks.length, db);
    return {
      ...preview,
      runId: run.id,
      sessionId: imported.sessionId,
      trackIds: imported.trackIds,
    };
  } catch (error) {
    await failPullRun(run, error instanceof Error ? error.message : String(error), db);
    throw error;
  }
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

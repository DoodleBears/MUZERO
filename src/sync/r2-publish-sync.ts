import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { R2LocalCredentials, SyncObject, SyncRun } from "@/db/types";
import { newId } from "@/lib/id";
import type { R2ExportObject, R2ExportPlan } from "./r2-export-plan";
import { publishR2ExportPlan, type R2PublishOptions } from "./r2-publish";

export interface R2PublishSyncOptions extends R2PublishOptions {
  db?: MuzeroDB;
}

export interface R2PublishSyncResult {
  runId: string;
}

export async function runR2PublishSync(
  plan: R2ExportPlan,
  credentials: R2LocalCredentials,
  options: R2PublishSyncOptions = {},
): Promise<R2PublishSyncResult> {
  const db = options.db ?? defaultDb;
  const now = Date.now();
  const runId = newId("run");
  const baseRun: SyncRun = {
    id: runId,
    driveId: plan.driveId,
    direction: "push",
    status: "running",
    startedAt: now,
    totalBytes: plan.totalBytes,
    bytesDone: 0,
    objectCount: plan.objects.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
  };
  await db.syncRuns.put(baseRun);

  try {
    const result = await publishR2ExportPlan(plan, credentials, options);
    const finishedAt = Date.now();
    await db.transaction("rw", db.syncRuns, db.syncObjects, async () => {
      await db.syncRuns.put({
        ...baseRun,
        status: "completed",
        finishedAt,
        bytesDone: result.bytesDone,
        uploaded: result.uploaded,
        skipped: result.skipped,
        failed: result.failed,
      });
      await db.syncObjects.bulkPut(
        plan.objects.map((object) => toSyncObject(plan.driveId, object, runId, finishedAt)),
      );
    });
    return { runId };
  } catch (error) {
    await db.syncRuns.put({
      ...baseRun,
      status: options.signal?.aborted ? "cancelled" : "failed",
      finishedAt: Date.now(),
      failed: 1,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function toSyncObject(
  driveId: string,
  object: R2ExportObject,
  runId: string,
  uploadedAt: number,
): SyncObject {
  return {
    id: syncObjectId(driveId, object.key),
    driveId,
    key: object.key,
    kind: object.kind,
    contentType: object.contentType,
    bytes: object.bytes,
    sha256: object.sha256,
    sourceSetId: object.setId,
    sourceTrackId: object.trackId,
    sourceMemoryId: object.memoryId,
    lastUploadedAt: uploadedAt,
    lastUploadedRunId: runId,
    updatedAt: uploadedAt,
  };
}

function syncObjectId(driveId: string, key: string): string {
  return `${driveId}:${key}`;
}

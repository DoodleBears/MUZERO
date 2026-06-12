import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { R2LocalCredentials, SyncObject, SyncRun } from "@/db/types";
import { newId } from "@/lib/id";
import type { R2ExportObject, R2ExportPlan } from "./r2-export-plan";
import { createDesktopR2LocalMedia } from "./r2-local-media";
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
    const knownUploadedObjects = await loadKnownUploadedObjects(plan.driveId, db);
    const localMedia = options.localMedia ?? createDesktopR2LocalMedia()?.publisher;
    const result = await publishR2ExportPlan(plan, credentials, {
      ...options,
      localMedia,
      isKnownUploaded: (object) =>
        options.isKnownUploaded?.(object) ?? isKnownUploadedObject(object, knownUploadedObjects),
      onObjectSynced: async (object, status) => {
        await options.onObjectSynced?.(object, status);
        if (!isResumableObject(object)) return;
        await db.syncObjects.put(toSyncObject(plan.driveId, object, runId, Date.now()));
        knownUploadedObjects.set(object.key, object);
      },
    });
    const finishedAt = Date.now();
    await db.transaction("rw", db.syncRuns, db.syncObjects, db.syncMutations, async () => {
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
      // The plan folded every pre-run unsynced mutation for this drive (plans
      // with overlapping mutations never reach the publisher — they short-circuit
      // to needs-review). Mark them synced so they don't re-fold, re-upload, and
      // re-conflict on every subsequent publish (audit F3).
      await db.syncMutations
        .where("driveId")
        .equals(plan.driveId)
        .filter((mutation) => mutation.syncedAt == null && mutation.createdAt <= baseRun.startedAt)
        .modify({ syncedAt: finishedAt });
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

async function loadKnownUploadedObjects(
  driveId: string,
  db: MuzeroDB,
): Promise<Map<string, Pick<SyncObject, "key" | "kind" | "sha256">>> {
  const rows = await db.syncObjects.where("driveId").equals(driveId).toArray();
  return new Map(rows.map((object) => [object.key, object]));
}

function isKnownUploadedObject(
  object: R2ExportObject,
  known: Map<string, Pick<SyncObject, "key" | "kind" | "sha256">>,
): boolean {
  if (!isResumableObject(object)) return false;
  // If planning proved the remote object is absent, a local stale upload record
  // is not enough; the guarded first write still has to recreate it remotely.
  if (object.precondition?.ifNoneMatch === "*") return false;
  const row = known.get(object.key);
  if (!row || row.kind !== object.kind) return false;
  return object.sha256 ? row.sha256 === object.sha256 : true;
}

function isResumableObject(object: R2ExportObject): boolean {
  return Boolean(object.sha256) || object.kind === "stats-events-segment";
}

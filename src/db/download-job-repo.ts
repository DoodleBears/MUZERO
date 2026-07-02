/**
 * CRUD for the persistent download queue (`downloadJobs`). Thin IO around Dexie — the
 * queue's decisions (dedupe, concurrency, retry, pause/resume) live in the pure
 * `download-queue` state machine; this only reads/writes rows.
 */

import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { DownloadJob } from "@/db/types";

/** All jobs, oldest first (queue order). */
export function listDownloadJobs(db: MuzeroDB = defaultDb): Promise<DownloadJob[]> {
  return db.downloadJobs.orderBy("createdAt").toArray();
}

export async function putDownloadJob(job: DownloadJob, db: MuzeroDB = defaultDb): Promise<void> {
  await db.downloadJobs.put(job);
}

/** Patch a job and bump `updatedAt`. */
export async function updateDownloadJob(
  id: string,
  patch: Partial<DownloadJob>,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await db.downloadJobs.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteDownloadJob(id: string, db: MuzeroDB = defaultDb): Promise<void> {
  await db.downloadJobs.delete(id);
}

/** An existing non-terminal job for the same target — used to dedupe enqueue. */
export async function findPendingJob(
  source: DownloadJob["source"],
  externalId: string,
  quality: string | undefined,
  audioOnly: boolean,
  db: MuzeroDB = defaultDb,
): Promise<DownloadJob | undefined> {
  return db.downloadJobs
    .where("status")
    .anyOf("pending", "active", "paused")
    .filter(
      (j) =>
        j.source === source &&
        j.externalId === externalId &&
        (j.quality ?? "") === (quality ?? "") &&
        Boolean(j.audioOnly) === audioOnly,
    )
    .first();
}

/** Remove finished jobs (UI "clear completed"). Returns the count cleared. */
export async function clearFinishedDownloadJobs(db: MuzeroDB = defaultDb): Promise<number> {
  return db.downloadJobs.where("status").equals("done").delete();
}

/** Remove every job (UI "clear all"). Returns the count cleared. Any in-flight download
 *  completes in the background — the runner's `update` on the deleted id is a no-op. */
export async function clearAllDownloadJobs(db: MuzeroDB = defaultDb): Promise<number> {
  return db.downloadJobs.toCollection().delete();
}

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession } from "@/db/types";
import { findPendingCloudDriveLocalChangesSince } from "./cloud-drive-dirty";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-cloud-drive-dirty-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("findPendingCloudDriveLocalChangesSince", () => {
  it("returns undefined when there are no publishable local changes", async () => {
    await seedSession({ id: "ses_old", updatedAt: 100 });
    await db.syncRuns.put({
      id: "run_done",
      driveId: "drv_a",
      direction: "push",
      status: "completed",
      startedAt: 200,
      finishedAt: 250,
      totalBytes: 0,
      bytesDone: 0,
      objectCount: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
    });

    await expect(findPendingCloudDriveLocalChangesSince("drv_a", db)).resolves.toBeUndefined();
  });

  it("returns the oldest changed local set after the latest completed push", async () => {
    await seedSession({ id: "ses_old", updatedAt: 100 });
    await seedSession({ id: "ses_newer", updatedAt: 400 });
    await seedSession({ id: "ses_newest", updatedAt: 700 });
    await seedSession({ id: "ses_remote_drv_b_ses_other", updatedAt: 300 });
    await db.syncRuns.bulkPut([
      {
        id: "run_old",
        driveId: "drv_a",
        direction: "push",
        status: "completed",
        startedAt: 150,
        finishedAt: 200,
        totalBytes: 0,
        bytesDone: 0,
        objectCount: 0,
        uploaded: 0,
        skipped: 0,
        failed: 0,
      },
      {
        id: "run_failed",
        driveId: "drv_a",
        direction: "push",
        status: "failed",
        startedAt: 800,
        finishedAt: 900,
        totalBytes: 0,
        bytesDone: 0,
        objectCount: 0,
        uploaded: 0,
        skipped: 0,
        failed: 1,
      },
    ]);

    await expect(findPendingCloudDriveLocalChangesSince("drv_a", db)).resolves.toBe(400);
  });

  it("includes sets imported from the same drive because co-edited sets write back", async () => {
    await seedSession({ id: "ses_remote_drv_a_ses_shared", updatedAt: 500 });
    await db.syncRuns.put({
      id: "run_done",
      driveId: "drv_a",
      direction: "push",
      status: "completed",
      startedAt: 100,
      finishedAt: 200,
      totalBytes: 0,
      bytesDone: 0,
      objectCount: 0,
      uploaded: 0,
      skipped: 0,
      failed: 0,
    });

    await expect(findPendingCloudDriveLocalChangesSince("drv_a", db)).resolves.toBe(500);
  });
});

async function seedSession(input: { id: string; updatedAt: number }) {
  const row: DjSession = {
    id: input.id,
    name: input.id,
    seedPrompt: "",
    trackIds: [],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 60,
      allowVocals: true,
    },
    displayMode: "cover",
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt,
  };
  await db.sessions.put(row);
}

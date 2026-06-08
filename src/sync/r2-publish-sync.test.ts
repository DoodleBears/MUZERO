import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { R2ExportPlan } from "./r2-export-plan";
import { runR2PublishSync } from "./r2-publish-sync";

let db: MuzeroDB;
let dbName: string;

const plan: R2ExportPlan = {
  driveId: "drv_1",
  libraryId: "lib_1",
  baseUrl: "https://music.example.com/muzero/",
  totalBytes: 3,
  objects: [
    {
      kind: "manifest",
      key: "manifest.json",
      contentType: "application/json",
      bytes: 3,
      body: "{}\n",
    },
  ],
};

const credentials = {
  accountId: "abc123",
  bucket: "muzero",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

beforeEach(() => {
  dbName = `muzero-r2-publish-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("runR2PublishSync", () => {
  it("persists a completed sync run and object mappings", async () => {
    const result = await runR2PublishSync(plan, credentials, {
      db,
      fetcher: async () => new Response(null, { status: 204 }),
      now: () => new Date("2026-06-09T01:02:03.000Z"),
    });

    const run = await db.syncRuns.get(result.runId);
    const object = await db.syncObjects.get("drv_1:manifest.json");

    expect(run).toMatchObject({
      id: result.runId,
      driveId: "drv_1",
      direction: "push",
      status: "completed",
      totalBytes: 3,
      bytesDone: 3,
      uploaded: 1,
      skipped: 0,
      failed: 0,
    });
    expect(object).toMatchObject({
      id: "drv_1:manifest.json",
      driveId: "drv_1",
      key: "manifest.json",
      kind: "manifest",
      lastUploadedRunId: result.runId,
    });
  });

  it("marks failed runs without deleting existing object mappings", async () => {
    await db.syncObjects.put({
      id: "drv_1:manifest.json",
      driveId: "drv_1",
      key: "manifest.json",
      kind: "manifest",
      contentType: "application/json",
      bytes: 3,
      lastUploadedAt: 1,
      lastUploadedRunId: "run_old",
      updatedAt: 1,
    });

    await expect(
      runR2PublishSync(plan, credentials, {
        db,
        fetcher: async () => new Response(null, { status: 500 }),
      }),
    ).rejects.toThrow("Failed to upload manifest.json");

    const runs = await db.syncRuns.toArray();
    const object = await db.syncObjects.get("drv_1:manifest.json");

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "failed", failed: 1 });
    expect(object?.lastUploadedRunId).toBe("run_old");
  });
});

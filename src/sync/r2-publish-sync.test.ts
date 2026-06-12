import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { __setDesktopBridge, type DesktopBridge } from "@/lib/desktop/bridge";
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
  __setDesktopBridge(null);
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

  it("opens referenced local-file objects with the desktop bridge by default", async () => {
    const sha256 = "3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7";
    const localPlan: R2ExportPlan = {
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      totalBytes: 4,
      objects: [
        {
          kind: "media",
          key: `objects/media/sha256-${sha256}.mp3`,
          contentType: "audio/mpeg",
          bytes: 4,
          sha256,
          body: {
            kind: "local-file",
            path: "/music/local.mp3",
            bytes: 4,
            mime: "audio/mpeg",
            sha256,
          },
        },
      ],
    };
    __setDesktopBridge({
      kind: "electron",
      fetch: globalThis.fetch,
      openExternal: async () => {},
      readFile: async () => new TextEncoder().encode("data"),
    } as DesktopBridge);

    const seen: Array<{ hash: string | null; body: string }> = [];
    const result = await runR2PublishSync(localPlan, credentials, {
      db,
      skipExistingChecks: true,
      fetcher: async (_url, init) => {
        seen.push({
          hash: new Headers(init?.headers).get("x-amz-content-sha256"),
          body: await new Response(init?.body).text(),
        });
        return new Response(null, { status: 204 });
      },
    });

    expect(seen).toEqual([{ hash: sha256, body: "data" }]);
    await expect(db.syncRuns.get(result.runId)).resolves.toMatchObject({
      status: "completed",
      uploaded: 1,
    });
  });

  it("skips unchanged JSON objects by locally recorded content hash", async () => {
    const smartPlan: R2ExportPlan = {
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      totalBytes: 11,
      objects: [
        {
          kind: "set-index",
          key: "sets/ses_1/index.json",
          contentType: "application/json",
          bytes: 8,
          body: '{"a":1}\n',
          sha256: "hash-a",
          setId: "ses_1",
        },
        {
          kind: "manifest",
          key: "manifest.json",
          contentType: "application/json",
          bytes: 3,
          body: "{}\n",
          sha256: "hash-b",
        },
      ],
    };

    await runR2PublishSync(smartPlan, credentials, {
      db,
      fetcher: async () => new Response(null, { status: 204 }),
    });

    const calls: Array<{ method?: string; url: string }> = [];
    const result = await runR2PublishSync(smartPlan, credentials, {
      db,
      fetcher: async (url, init) => {
        calls.push({ method: init?.method, url: String(url) });
        return new Response(null, { status: 204 });
      },
    });

    const run = await db.syncRuns.get(result.runId);
    expect(calls).toEqual([]);
    expect(run).toMatchObject({
      status: "completed",
      bytesDone: 11,
      uploaded: 0,
      skipped: 2,
      failed: 0,
    });
  });

  it("marks the drive's unsynced set mutations as synced after a successful publish (F3)", async () => {
    await db.syncMutations.bulkPut([
      {
        id: "mut_unsynced",
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        payload: { name: "A" },
        createdAt: 1,
      },
      {
        id: "mut_other_drive",
        driveId: "drv_2",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        payload: { name: "B" },
        createdAt: 1,
      },
      {
        id: "mut_already",
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        payload: { name: "C" },
        createdAt: 1,
        syncedAt: 42,
      },
    ]);

    await runR2PublishSync(plan, credentials, {
      db,
      fetcher: async () => new Response(null, { status: 204 }),
    });

    expect((await db.syncMutations.get("mut_unsynced"))?.syncedAt).toBeGreaterThan(0);
    expect((await db.syncMutations.get("mut_other_drive"))?.syncedAt).toBeUndefined();
    expect((await db.syncMutations.get("mut_already"))?.syncedAt).toBe(42);
  });

  it("leaves mutations unsynced when the publish fails (F3)", async () => {
    await db.syncMutations.put({
      id: "mut_unsynced",
      driveId: "drv_1",
      devicePublicId: "dvc_1",
      scope: "set",
      entityId: "ses_1",
      action: "set-metadata-updated",
      payload: { name: "A" },
      createdAt: 1,
    });

    await expect(
      runR2PublishSync(plan, credentials, {
        db,
        fetcher: async () => new Response(null, { status: 500 }),
        retry: { sleep: async () => {} },
      }),
    ).rejects.toThrow();

    expect((await db.syncMutations.get("mut_unsynced"))?.syncedAt).toBeUndefined();
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

  it("retries a failed playback segment sync by skipping an already uploaded immutable segment", async () => {
    const retryPlan: R2ExportPlan = {
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      totalBytes: 20,
      objects: [
        {
          kind: "stats-events-segment",
          key: "stats/events/dvc_1/1000-1000-abcdef0123456789.json",
          contentType: "application/json",
          bytes: 12,
          body: '{"events":[]}\n',
        },
        {
          kind: "stats-checkpoint",
          key: "stats/devices/dvc_1/checkpoint.json",
          contentType: "application/json",
          bytes: 8,
          body: '{"ok":1}\n',
        },
      ],
    };

    await expect(
      runR2PublishSync(retryPlan, credentials, {
        db,
        fetcher: async (url, init) => {
          if (init?.method === "PUT" && String(url).includes("checkpoint.json")) {
            return new Response(null, { status: 500 });
          }
          return new Response(null, { status: 204 });
        },
      }),
    ).rejects.toThrow("Failed to upload stats/devices/dvc_1/checkpoint.json");

    const calls: Array<{ method?: string; url: string }> = [];
    const result = await runR2PublishSync(retryPlan, credentials, {
      db,
      fetcher: async (url, init) => {
        calls.push({ method: init?.method, url: String(url) });
        return new Response(null, { status: 204 });
      },
    });

    const run = await db.syncRuns.get(result.runId);
    const segmentCalls = calls.filter((call) => call.url.includes("/stats/events/"));
    expect(segmentCalls).toEqual([]);
    expect(run).toMatchObject({
      status: "completed",
      uploaded: 1,
      skipped: 1,
    });
  });

  it("resumes a failed first publish by reusing locally recorded immutable uploads", async () => {
    const resumePlan: R2ExportPlan = {
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      totalBytes: 16,
      objects: [
        {
          kind: "media",
          key: "objects/media/sha256-a.mp3",
          contentType: "audio/mpeg",
          bytes: 3,
          body: new Blob(["abc"], { type: "audio/mpeg" }),
          sha256: "a",
          setId: "ses_1",
          trackId: "trk_1",
        },
        {
          kind: "set-index",
          key: "sets/ses_1/index.json",
          contentType: "application/json",
          bytes: 6,
          body: "{}\n",
          setId: "ses_1",
        },
        {
          kind: "manifest",
          key: "manifest.json",
          contentType: "application/json",
          bytes: 7,
          body: "{}\n",
        },
      ],
    };

    await expect(
      runR2PublishSync(resumePlan, credentials, {
        db,
        fetcher: async (url, init) => {
          if (init?.method === "PUT" && String(url).includes("/sets/ses_1/index.json")) {
            return new Response(null, { status: 500 });
          }
          return new Response(null, { status: 204 });
        },
        skipExistingChecks: true,
        retry: { sleep: async () => {} },
      }),
    ).rejects.toThrow("Failed to upload sets/ses_1/index.json");

    await expect(db.syncObjects.get("drv_1:objects/media/sha256-a.mp3")).resolves.toMatchObject({
      key: "objects/media/sha256-a.mp3",
      sha256: "a",
    });

    const calls: Array<{ method?: string; url: string }> = [];
    const result = await runR2PublishSync(resumePlan, credentials, {
      db,
      skipExistingChecks: true,
      fetcher: async (url, init) => {
        calls.push({ method: init?.method, url: String(url) });
        return new Response(null, { status: 204 });
      },
    });

    const run = await db.syncRuns.get(result.runId);
    const mediaCalls = calls.filter((call) => call.url.includes("/objects/media/sha256-a.mp3"));
    expect(mediaCalls).toEqual([]);
    expect(run).toMatchObject({ status: "completed", uploaded: 2, skipped: 1 });
  });
});

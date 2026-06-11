import { waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MuzeroDB } from "@/db/muzero-db";
import type { PublishDriveContext, SyncOrchestrator, SyncProgress } from "@/sync/sync-orchestrator";

let openedDb: MuzeroDB | null = null;

async function deleteDefaultDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("muzero-db");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

beforeEach(async () => {
  vi.resetModules();
  await deleteDefaultDb();
});

afterEach(async () => {
  openedDb?.close();
  openedDb = null;
  await deleteDefaultDb();
});

async function loadStore() {
  const dbMod = await import("@/db/muzero-db");
  openedDb = dbMod.db;
  const repos = await import("@/db/repositories");
  const cloudRepo = await import("@/sync/cloud-drive-repo");
  const storeMod = await import("./sync-store");
  return { db: dbMod.db, repos, cloudRepo, storeMod, useSyncStore: storeMod.useSyncStore };
}

async function seedWritableDrive() {
  const ctx = await loadStore();
  await ctx.cloudRepo.upsertCloudDrive({
    id: "drv_owned",
    label: "My Drive",
    kind: "owned",
    provider: "r2",
    publicBaseUrl: "https://drive.example.com/muzero/",
    manifestUrl: "https://drive.example.com/muzero/manifest.json",
    capabilities: {
      read: true,
      write: true,
      manageInvites: false,
      writeStats: true,
      writePresence: true,
    },
  });
  await ctx.repos.saveSettings({
    r2CredentialsByDriveId: {
      drv_owned: {
        accountId: "acct",
        bucket: "bucket",
        accessKeyId: "key",
        secretAccessKey: "secret",
      },
    },
  });
  const s1 = await ctx.repos.createSession({
    seedPrompt: "",
    config: { autoExtend: false },
    displayMode: "cover",
  });
  const s2 = await ctx.repos.createSession({
    seedPrompt: "",
    config: { autoExtend: false },
    displayMode: "cover",
  });
  // A remote-imported set must NOT be re-published to the owner's own drive.
  await ctx.db.sessions.put({
    id: "ses_remote_drv_x_ses_a",
    name: "Remote set",
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
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { ...ctx, localSetIds: [s1.id, s2.id] };
}

function completedProgress(driveId: string): SyncProgress {
  return {
    driveId,
    direction: "push",
    phase: "completed",
    objectsDone: 2,
    objectsTotal: 2,
    bytesDone: 100,
    bytesTotal: 100,
    runId: "run_done",
  };
}

describe("sync-store publishDrive", () => {
  it("resolves the publish context from IndexedDB and maps progress into ephemeral state", async () => {
    const { storeMod, useSyncStore, localSetIds } = await seedWritableDrive();

    let captured: PublishDriveContext | undefined;
    const orchestrator: SyncOrchestrator = {
      publish: vi.fn(async (ctx, options) => {
        captured = ctx;
        options?.onProgress?.({ ...completedProgress(ctx.drive.id), phase: "uploading" });
        options?.onProgress?.(completedProgress(ctx.drive.id));
        return { status: "completed" as const, runId: "run_done" };
      }),
      pull: vi.fn(),
    };
    storeMod.__setSyncOrchestratorForTest(orchestrator);

    await useSyncStore.getState().publishDrive("drv_owned");

    expect(captured).toMatchObject({
      drive: { id: "drv_owned" },
      libraryId: "drv_owned",
      baseUrl: "https://drive.example.com/muzero/",
      credentials: { bucket: "bucket", accessKeyId: "key" },
    });
    // Only local-origin sets are published; remote-imported sets are excluded.
    expect(captured?.setIds.sort()).toEqual([...localSetIds].sort());
    expect(useSyncStore.getState().progressByDrive.drv_owned).toMatchObject({
      phase: "completed",
      objectsDone: 2,
      runId: "run_done",
    });

    storeMod.__setSyncOrchestratorForTest(null);
  });

  it("marks failed without invoking the orchestrator when credentials are missing", async () => {
    const ctx = await loadStore();
    await ctx.cloudRepo.upsertCloudDrive({
      id: "drv_owned",
      label: "My Drive",
      kind: "owned",
      provider: "r2",
      publicBaseUrl: "https://drive.example.com/muzero/",
      manifestUrl: "https://drive.example.com/muzero/manifest.json",
      capabilities: {
        read: true,
        write: true,
        manageInvites: false,
        writeStats: true,
        writePresence: true,
      },
    });
    const publish = vi.fn();
    ctx.storeMod.__setSyncOrchestratorForTest({ publish, pull: vi.fn() });

    await ctx.useSyncStore.getState().publishDrive("drv_owned");

    expect(publish).not.toHaveBeenCalled();
    expect(ctx.useSyncStore.getState().progressByDrive.drv_owned).toMatchObject({
      phase: "failed",
    });
    expect(ctx.useSyncStore.getState().progressByDrive.drv_owned.error).toMatch(/credential/i);

    ctx.storeMod.__setSyncOrchestratorForTest(null);
  });

  it("marks failed for a read-only drive without invoking the orchestrator", async () => {
    const ctx = await loadStore();
    await ctx.cloudRepo.upsertCloudDrive({
      id: "drv_shared",
      label: "Shared",
      kind: "shared",
      provider: "r2",
      publicBaseUrl: "https://shared.example.com/muzero/",
      manifestUrl: "https://shared.example.com/muzero/manifest.json",
      capabilities: {
        read: true,
        write: false,
        manageInvites: false,
        writeStats: false,
        writePresence: false,
      },
    });
    const publish = vi.fn();
    ctx.storeMod.__setSyncOrchestratorForTest({ publish, pull: vi.fn() });

    await ctx.useSyncStore.getState().publishDrive("drv_shared");

    expect(publish).not.toHaveBeenCalled();
    expect(ctx.useSyncStore.getState().progressByDrive.drv_shared).toMatchObject({
      phase: "failed",
    });

    ctx.storeMod.__setSyncOrchestratorForTest(null);
  });

  it("refuses to start a second operation on a drive while one is in flight (F8)", async () => {
    const { storeMod, useSyncStore } = await seedWritableDrive();

    const orchestrator: SyncOrchestrator = {
      publish: vi.fn(async (ctx, options) => {
        options?.onProgress?.({ ...completedProgress(ctx.drive.id), phase: "uploading" });
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve());
        });
        return { status: "cancelled" as const };
      }),
      pull: vi.fn(),
    };
    storeMod.__setSyncOrchestratorForTest(orchestrator);

    const pending = useSyncStore.getState().publishDrive("drv_owned");
    await waitFor(() =>
      expect(useSyncStore.getState().progressByDrive.drv_owned?.phase).toBe("uploading"),
    );
    // Concurrent publish AND pull on the same drive are refused — they would
    // overwrite each other's AbortController and interleave one progress line.
    await useSyncStore.getState().publishDrive("drv_owned");
    await useSyncStore.getState().pullRemoteSet({ driveId: "drv_owned", remoteSet: {} } as never);
    expect(orchestrator.publish).toHaveBeenCalledTimes(1);
    expect(orchestrator.pull).not.toHaveBeenCalled();

    useSyncStore.getState().cancel("drv_owned");
    await pending;
    storeMod.__setSyncOrchestratorForTest(null);
  });

  it("cancel() aborts the in-flight publish signal", async () => {
    const { storeMod, useSyncStore } = await seedWritableDrive();

    const orchestrator: SyncOrchestrator = {
      publish: vi.fn(async (ctx, options) => {
        options?.onProgress?.({ ...completedProgress(ctx.drive.id), phase: "uploading" });
        await new Promise<void>((resolve) => {
          options?.signal?.addEventListener("abort", () => resolve());
        });
        options?.onProgress?.({ ...completedProgress(ctx.drive.id), phase: "cancelled" });
        return { status: "cancelled" as const };
      }),
      pull: vi.fn(),
    };
    storeMod.__setSyncOrchestratorForTest(orchestrator);

    const pending = useSyncStore.getState().publishDrive("drv_owned");
    await waitFor(() =>
      expect(useSyncStore.getState().progressByDrive.drv_owned?.phase).toBe("uploading"),
    );
    useSyncStore.getState().cancel("drv_owned");
    await pending;

    expect(useSyncStore.getState().progressByDrive.drv_owned).toMatchObject({ phase: "cancelled" });

    storeMod.__setSyncOrchestratorForTest(null);
  });
});

describe("sync-store pullRemoteSet", () => {
  it("runs the orchestrator pull and maps progress into ephemeral state", async () => {
    const { storeMod, useSyncStore } = await loadStore();

    const input = { driveId: "drv_owned", remoteSet: {} } as never;
    const orchestrator: SyncOrchestrator = {
      publish: vi.fn(),
      pull: vi.fn(async (_input, options) => {
        options?.onProgress?.({
          driveId: "drv_owned",
          direction: "pull",
          phase: "applying",
          objectsDone: 0,
          objectsTotal: 3,
          bytesDone: 0,
          bytesTotal: 300,
        });
        options?.onProgress?.({
          driveId: "drv_owned",
          direction: "pull",
          phase: "completed",
          objectsDone: 3,
          objectsTotal: 3,
          bytesDone: 300,
          bytesTotal: 300,
          runId: "run_pull",
        });
        return { status: "completed" as const, mutated: true, runId: "run_pull" };
      }),
    };
    storeMod.__setSyncOrchestratorForTest(orchestrator);

    await useSyncStore.getState().pullRemoteSet(input);

    expect(orchestrator.pull).toHaveBeenCalledWith(input, expect.objectContaining({}));
    expect(useSyncStore.getState().progressByDrive.drv_owned).toMatchObject({
      direction: "pull",
      phase: "completed",
      runId: "run_pull",
    });

    storeMod.__setSyncOrchestratorForTest(null);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  listCloudDrives,
  listCloudShares,
  updateCloudDriveSyncPreferences,
  upsertCloudDrive,
  upsertCloudShare,
} from "./cloud-drive-repo";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-cloud-drive-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("cloud drive repository", () => {
  it("stores owned R2 drives with explicit capabilities", async () => {
    await upsertCloudDrive(
      {
        id: "drv_personal",
        label: "Personal R2",
        kind: "owned",
        provider: "r2",
        publicBaseUrl: "https://music.example.com/muzero/",
        manifestUrl: "https://music.example.com/muzero/manifest.json",
        capabilities: {
          read: true,
          write: true,
          manageInvites: false,
          writeStats: true,
          writePresence: false,
        },
      },
      db,
    );

    expect(await listCloudDrives(db)).toMatchObject([
      {
        id: "drv_personal",
        kind: "owned",
        provider: "r2",
        capabilities: {
          read: true,
          write: true,
        },
      },
    ]);
  });

  it("defaults cloud sync scheduling preferences and preserves explicit choices", async () => {
    const defaulted = await upsertCloudDrive(
      {
        id: "drv_default_sync",
        label: "Default Sync",
        kind: "owned",
        provider: "r2",
        capabilities: {
          read: true,
          write: true,
          manageInvites: false,
          writeStats: true,
          writePresence: true,
        },
      },
      db,
    );

    expect(defaulted.autoSyncFrequency).toBe("manual");
    expect(defaulted.uploadConcurrency).toBe(2);

    const customized = await upsertCloudDrive(
      {
        ...defaulted,
        autoSyncFrequency: "30min",
        uploadConcurrency: 3,
      },
      db,
    );

    expect(customized.autoSyncFrequency).toBe("30min");
    expect(customized.uploadConcurrency).toBe(3);
  });

  it("updates cloud sync preferences without replacing the drive", async () => {
    const initial = await upsertCloudDrive(
      {
        id: "drv_sync_prefs",
        label: "Sync Prefs",
        kind: "owned",
        provider: "r2",
        publicBaseUrl: "https://music.example.com/muzero/",
        capabilities: {
          read: true,
          write: true,
          manageInvites: false,
          writeStats: true,
          writePresence: true,
        },
        createdAt: 100,
        updatedAt: 200,
      },
      db,
    );

    const updated = await updateCloudDriveSyncPreferences(
      "drv_sync_prefs",
      { autoSyncFrequency: "change-debounce", uploadConcurrency: 1 },
      db,
    );

    expect(updated).toMatchObject({
      id: "drv_sync_prefs",
      label: "Sync Prefs",
      publicBaseUrl: "https://music.example.com/muzero/",
      autoSyncFrequency: "change-debounce",
      uploadConcurrency: 1,
      createdAt: initial.createdAt,
    });
    expect(updated.updatedAt).toBeGreaterThan(initial.updatedAt);
  });

  it("stores read-only shared links separately from owned drives", async () => {
    await upsertCloudDrive(
      {
        id: "drv_shared",
        label: "Shared With Me",
        kind: "shared",
        provider: "r2",
        manifestUrl: "https://friend.example.com/muzero/manifest.json",
        capabilities: {
          read: true,
          write: false,
          manageInvites: false,
          writeStats: false,
          writePresence: false,
        },
      },
      db,
    );
    await upsertCloudShare(
      {
        id: "shr_tokyo",
        driveId: "drv_shared",
        remoteShareId: "shr_tokyo",
        label: "Tokyo Night Drive",
        sourceOwnerName: "Friend",
        manifestUrl: "https://friend.example.com/muzero/shares/shr_tokyo/manifest.json",
        access: "read-only",
      },
      db,
    );

    expect(await listCloudShares(db)).toMatchObject([
      {
        id: "shr_tokyo",
        driveId: "drv_shared",
        access: "read-only",
      },
    ]);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  listCloudDrives,
  listCloudShares,
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

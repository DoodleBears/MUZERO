import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, Track } from "@/db/types";
import { refreshImportedSetSourceAttribution } from "./cloud-source-attribution";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-cloud-source-attribution-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("refreshImportedSetSourceAttribution", () => {
  it("refreshes an existing imported set and its remote tracks with profile attribution", async () => {
    await seedImportedSet();

    const result = await refreshImportedSetSourceAttribution(
      {
        driveId: "drv_1",
        remoteSetId: "ses_tokyo",
        source: {
          driveId: "drv_1",
          driveLabel: "Friend Drive",
          devicePublicId: "dvc_friend",
          displayName: "Browser",
          avatarSeed: "green",
          avatarUrl: "https://pub.example.com/muzero/objects/avatars/browser.jpg",
        },
      },
      db,
    );

    expect(result).toEqual({ sessionsUpdated: 1, tracksUpdated: 1 });
    await expect(db.sessions.get("ses_remote_drv_1_ses_tokyo")).resolves.toMatchObject({
      cloudSource: {
        displayName: "Browser",
        avatarSeed: "green",
        avatarUrl: "https://pub.example.com/muzero/objects/avatars/browser.jpg",
      },
    });
    await expect(db.tracks.get("trk_remote_drv_1_trk_blue")).resolves.toMatchObject({
      cloudSource: {
        displayName: "Browser",
        avatarSeed: "green",
        avatarUrl: "https://pub.example.com/muzero/objects/avatars/browser.jpg",
      },
    });
    await expect(db.tracks.get("trk_local_only")).resolves.toMatchObject({
      cloudSource: undefined,
    });
  });

  it("does nothing when the imported set is not present locally", async () => {
    const result = await refreshImportedSetSourceAttribution(
      {
        driveId: "drv_1",
        remoteSetId: "ses_missing",
        source: {
          driveId: "drv_1",
          devicePublicId: "dvc_friend",
          displayName: "Browser",
        },
      },
      db,
    );

    expect(result).toEqual({ sessionsUpdated: 0, tracksUpdated: 0 });
    expect(await db.sessions.count()).toBe(0);
    expect(await db.tracks.count()).toBe(0);
  });
});

async function seedImportedSet() {
  const staleSource = {
    driveId: "drv_1",
    driveLabel: "Friend Drive",
    devicePublicId: "dvc_friend",
    avatarSeed: "dvc_friend",
  };
  const session: DjSession = {
    id: "ses_remote_drv_1_ses_tokyo",
    name: "Tokyo",
    seedPrompt: "",
    trackIds: ["trk_remote_drv_1_trk_blue", "trk_local_only"],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "cover",
    cloudSource: staleSource,
    createdAt: 1000,
    updatedAt: 1000,
  };
  const remoteTrack: Track = {
    id: "trk_remote_drv_1_trk_blue",
    sessionId: session.id,
    title: "Blue",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    playCount: 0,
    liked: false,
    tags: [],
    cloudSource: staleSource,
    createdAt: 1000,
  };
  const localTrack: Track = {
    ...remoteTrack,
    id: "trk_local_only",
    title: "Local voice memo",
    cloudSource: undefined,
  };
  await db.sessions.put(session);
  await db.tracks.bulkPut([remoteTrack, localTrack]);
}

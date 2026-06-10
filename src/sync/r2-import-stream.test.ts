import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { importRemoteSetStream } from "./r2-import-stream";
import type { RemoteSetIndexResult } from "./r2-subscription";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-remote-import-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

const remoteSet: RemoteSetIndexResult = {
  indexUrl: "https://music.example.com/muzero/sets/ses_tokyo/index.json",
  index: {
    schema: "muzero-r2-set-index-v1",
    revision: 1,
    set: {
      id: "ses_tokyo",
      name: "Tokyo Night Drive",
      seedPrompt: "rainy Tokyo night drive",
      displayMode: "video",
      config: {
        autoExtend: true,
        refillThreshold: 2,
        batchSize: 1,
        targetDurationSec: 60,
        allowVocals: true,
      },
      createdAt: 1780944000000,
      updatedAt: 1780944000000,
    },
    tracks: [
      {
        id: "trk_blue",
        title: "Blue Highway",
        kind: "audio",
        origin: "uploaded",
        provider: "upload",
        durationSec: 214,
        createdAt: 1780944000000,
        liked: true,
        tags: ["night"],
        mediaMetadata: {
          album: "Moonstone Beach",
          artists: ["Deidian"],
          originalFileName: "blue-highway.mp3",
          originalMime: "audio/mpeg",
          parser: "music-metadata",
          parsedAt: 1780944000000,
          title: "Blue Highway",
        },
        media: {
          key: "objects/media/sha256-blue.mp3",
          url: "objects/media/sha256-blue.mp3",
          mime: "audio/mpeg",
          bytes: 8241123,
        },
        memories: [
          {
            id: "mem_1",
            note: "sea night",
            author: {
              devicePublicId: "dvc_friend",
              displayName: "Friend phone",
              avatarSeed: "green",
            },
            createdAt: 1780944000000,
            photo: {
              key: "objects/memories/mem_1.jpg",
              url: "objects/memories/mem_1.jpg",
              mime: "image/jpeg",
              bytes: 742001,
            },
          },
        ],
      },
    ],
  },
  tracks: [
    {
      id: "trk_blue",
      title: "Blue Highway",
      mediaUrl: "https://music.example.com/muzero/objects/media/sha256-blue.mp3",
      coverUrl: "https://music.example.com/muzero/objects/covers/blue.jpg",
      memoryPhotoUrls: [
        {
          memoryId: "mem_1",
          url: "https://music.example.com/muzero/objects/memories/mem_1.jpg",
        },
      ],
      source: {
        id: "trk_blue",
        title: "Blue Highway",
        kind: "audio",
        origin: "uploaded",
        provider: "upload",
        durationSec: 214,
        createdAt: 1780944000000,
        liked: true,
        tags: ["night"],
        mediaMetadata: {
          album: "Moonstone Beach",
          artists: ["Deidian"],
          originalFileName: "blue-highway.mp3",
          originalMime: "audio/mpeg",
          parser: "music-metadata",
          parsedAt: 1780944000000,
          title: "Blue Highway",
        },
        media: {
          key: "objects/media/sha256-blue.mp3",
          url: "objects/media/sha256-blue.mp3",
          mime: "audio/mpeg",
          bytes: 8241123,
        },
        memories: [
          {
            id: "mem_1",
            note: "sea night",
            author: {
              devicePublicId: "dvc_friend",
              displayName: "Friend phone",
              avatarSeed: "green",
            },
            createdAt: 1780944000000,
            photo: {
              key: "objects/memories/mem_1.jpg",
              url: "objects/memories/mem_1.jpg",
              mime: "image/jpeg",
              bytes: 742001,
            },
          },
        ],
      },
    },
  ],
};

describe("importRemoteSetStream", () => {
  it("creates a local playable stream set without downloading media blobs", async () => {
    const result = await importRemoteSetStream(
      {
        driveId: "drv_a",
        remoteSet,
      },
      db,
    );

    const session = await db.sessions.get(result.sessionId);
    expect(session).toMatchObject({
      name: "Tokyo Night Drive",
      displayMode: "video",
      trackIds: [result.trackIds[0]],
    });

    const track = await db.tracks.get(result.trackIds[0]!);
    expect(track).toMatchObject({
      title: "Blue Highway",
      mediaMetadata: {
        album: "Moonstone Beach",
        artists: ["Deidian"],
      },
      remoteMediaUrl: "https://music.example.com/muzero/objects/media/sha256-blue.mp3",
      remoteCoverUrl: "https://music.example.com/muzero/objects/covers/blue.jpg",
    });
    expect(track?.blobId).toBeUndefined();

    const memories = await db.memories.where("trackId").equals(result.trackIds[0]!).toArray();
    expect(memories[0]).toMatchObject({
      note: "sea night",
      remotePhotoUrl: "https://music.example.com/muzero/objects/memories/mem_1.jpg",
      author: {
        devicePublicId: "dvc_friend",
        displayName: "Friend phone",
        avatarSeed: "green",
      },
    });
    expect(await db.mediaBlobs.count()).toBe(0);
  });

  it("carries the cover thumbhash from the manifest onto the imported track", async () => {
    const withThumbhash: RemoteSetIndexResult = {
      ...remoteSet,
      tracks: remoteSet.tracks.map((tr) => ({
        ...tr,
        source: { ...tr.source, thumbhash: "SETTH64" },
      })),
    };
    await importRemoteSetStream({ driveId: "drv_th", remoteSet: withThumbhash }, db);
    const track = await db.tracks.get("trk_remote_drv_th_trk_blue");
    expect(track?.coverThumbhash).toBe("SETTH64");
  });

  it("is idempotent for duplicate remote set imports", async () => {
    await importRemoteSetStream({ driveId: "drv_a", remoteSet }, db);
    await importRemoteSetStream({ driveId: "drv_a", remoteSet }, db);

    expect(await db.sessions.count()).toBe(1);
    expect(await db.tracks.count()).toBe(1);
    expect(await db.memories.count()).toBe(1);
  });

  it("preserves local-only tracks when refreshing a remote set", async () => {
    await importRemoteSetStream({ driveId: "drv_a", remoteSet }, db);
    await db.tracks.put({
      id: "trk_local_journal",
      sessionId: "ses_remote_drv_a_ses_tokyo",
      title: "Voice Memo",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      status: "ready",
      durationSec: 42,
      createdAt: 1780945000000,
      playCount: 0,
      liked: false,
      tags: ["local"],
    });
    await db.sessions.update("ses_remote_drv_a_ses_tokyo", {
      trackIds: ["trk_remote_drv_a_trk_blue", "trk_local_journal"],
    });

    await importRemoteSetStream({ driveId: "drv_a", remoteSet }, db);

    await expect(db.sessions.get("ses_remote_drv_a_ses_tokyo")).resolves.toMatchObject({
      trackIds: ["trk_remote_drv_a_trk_blue", "trk_local_journal"],
    });
    await expect(db.tracks.get("trk_local_journal")).resolves.toMatchObject({
      title: "Voice Memo",
      sessionId: "ses_remote_drv_a_ses_tokyo",
    });
  });
});

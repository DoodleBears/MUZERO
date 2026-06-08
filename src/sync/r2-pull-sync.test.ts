import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { applyRemoteSetPull, dryRunRemoteSetPull } from "./r2-pull-sync";
import type { RemoteSetIndexResult } from "./r2-subscription";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-pull-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("R2 pull sync", () => {
  it("dry-runs a remote create without mutating IndexedDB", async () => {
    const preview = await dryRunRemoteSetPull({ driveId: "drv_1", remoteSet: remoteSet() }, db);

    expect(preview).toMatchObject({
      action: "create-set",
      willMutate: true,
      trackCount: 1,
      bytes: 3,
    });
    expect(await db.sessions.count()).toBe(0);
    expect(await db.tracks.count()).toBe(0);
  });

  it("applies a remote set as stream rows without downloading media bytes", async () => {
    const result = await applyRemoteSetPull({ driveId: "drv_1", remoteSet: remoteSet() }, db);

    expect(result.sessionId).toBeDefined();
    const session = await db.sessions.get(result.sessionId!);
    const track = await db.tracks.get(result.trackIds[0]!);

    expect(result).toMatchObject({ action: "create-set", trackIds: expect.any(Array) });
    expect(session?.name).toBe("Tokyo");
    expect(track).toMatchObject({
      title: "Blue",
      remoteMediaUrl: "https://music.example.com/muzero/objects/media/blue.mp3",
    });
    expect(track?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
    expect(await db.syncRuns.toArray()).toMatchObject([{ direction: "pull", status: "completed" }]);
  });

  it("does not mutate when the diff is blocked", async () => {
    await db.sessions.put({
      id: "ses_remote_drv_1_ses_tokyo",
      name: "Tokyo",
      seedPrompt: "",
      trackIds: [],
      status: "idle",
      config: {
        autoExtend: false,
        refillThreshold: 2,
        batchSize: 1,
        targetDurationSec: 180,
        allowVocals: true,
      },
      displayMode: "cover",
      createdAt: 1000,
      updatedAt: 1000,
    });
    await db.syncObjects.put({
      id: "drv_1:sets/ses_tokyo/index.json",
      driveId: "drv_1",
      key: "sets/ses_tokyo/index.json",
      kind: "set-index",
      contentType: "application/json",
      bytes: 1,
      sha256: "old",
      updatedAt: 1000,
    });

    await expect(
      applyRemoteSetPull(
        {
          driveId: "drv_1",
          remoteSet: remoteSet({ updatedAt: 2000 }),
          remoteIndexSha256: "new",
        },
        db,
      ),
    ).rejects.toThrow(/hash-mismatch/i);

    expect(await db.tracks.count()).toBe(0);
  });
});

function remoteSet(input: { updatedAt?: number } = {}): RemoteSetIndexResult {
  const updatedAt = input.updatedAt ?? 1000;
  return {
    indexUrl: "https://music.example.com/muzero/sets/ses_tokyo/index.json",
    index: {
      schema: "muzero-r2-set-index-v1",
      revision: 1,
      set: {
        id: "ses_tokyo",
        name: "Tokyo",
        seedPrompt: "",
        displayMode: "cover",
        config: {
          autoExtend: false,
          refillThreshold: 2,
          batchSize: 1,
          targetDurationSec: 180,
          allowVocals: true,
        },
        createdAt: 1000,
        updatedAt,
      },
      tracks: [
        {
          id: "trk_blue",
          title: "Blue",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 180,
          createdAt: 1000,
          liked: false,
          tags: [],
          media: {
            url: "objects/media/blue.mp3",
            mime: "audio/mpeg",
            bytes: 3,
            sha256: "media-sha",
          },
          memories: [],
        },
      ],
    },
    tracks: [
      {
        id: "trk_blue",
        title: "Blue",
        mediaUrl: "https://music.example.com/muzero/objects/media/blue.mp3",
        memoryPhotoUrls: [],
        source: {
          id: "trk_blue",
          title: "Blue",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 180,
          createdAt: 1000,
          liked: false,
          tags: [],
          media: {
            url: "objects/media/blue.mp3",
            mime: "audio/mpeg",
            bytes: 3,
            sha256: "media-sha",
          },
          memories: [],
        },
      },
    ],
  };
}

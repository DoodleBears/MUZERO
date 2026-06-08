import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { importR2PlaybackAggregateCache } from "./r2-playback-aggregate-cache";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-aggregate-cache-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("importR2PlaybackAggregateCache", () => {
  it("imports rebuildable per-device aggregate cache rows", async () => {
    const result = await importR2PlaybackAggregateCache(
      {
        schema: "muzero-r2-playback-aggregate-v1",
        devicePublicId: "dvc_friend",
        updatedAt: 2_000,
        aggregates: [
          {
            id: "dvc_friend:track:trk_remote",
            scope: "track",
            remoteTrackId: "trk_remote",
            playCount: 3,
            listenedSec: 180,
            lastPlayedAt: 1_900,
            updatedAt: 2_000,
          },
          {
            id: "dvc_friend:set:ses_remote",
            scope: "set",
            setId: "ses_remote",
            playCount: 2,
            listenedSec: 120,
            updatedAt: 2_000,
          },
        ],
      },
      db,
    );

    expect(result).toEqual({ devicePublicId: "dvc_friend", imported: 2 });
    await expect(db.playbackAggregates.toArray()).resolves.toEqual(
      expect.arrayContaining([
        {
          id: "dvc_friend:track:trk_remote",
          devicePublicId: "dvc_friend",
          scope: "track",
          remoteTrackId: "trk_remote",
          playCount: 3,
          listenedSec: 180,
          lastPlayedAt: 1_900,
          updatedAt: 2_000,
        },
        {
          id: "dvc_friend:set:ses_remote",
          devicePublicId: "dvc_friend",
          scope: "set",
          setId: "ses_remote",
          playCount: 2,
          listenedSec: 120,
          updatedAt: 2_000,
        },
      ]),
    );
  });

  it("rejects malformed aggregate cache objects without mutating IndexedDB", async () => {
    await expect(
      importR2PlaybackAggregateCache(
        {
          schema: "muzero-r2-playback-aggregate-v1",
          devicePublicId: "dvc_friend",
          updatedAt: 2_000,
          aggregates: [{ id: "bad", scope: "track", playCount: -1 }],
        },
        db,
      ),
    ).rejects.toThrow("Invalid R2 playback aggregate cache");

    expect(await db.playbackAggregates.count()).toBe(0);
  });
});

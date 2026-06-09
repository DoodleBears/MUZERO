import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import { summarizePlaybackAggregates } from "./playback-aggregate-summary";
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

  it("merges stats additively across imported per-device aggregate caches", async () => {
    await importR2PlaybackAggregateCache(aggregateCache("dvc_a", 2, 120), db);
    await importR2PlaybackAggregateCache(aggregateCache("dvc_b", 3, 180), db);

    const rows = await db.playbackAggregates.toArray();

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.devicePublicId))).toEqual(new Set(["dvc_a", "dvc_b"]));
    expect(
      summarizePlaybackAggregates(rows, {
        scope: "track",
        remoteTrackId: "trk_remote",
      }),
    ).toEqual({
      deviceCount: 2,
      playCount: 5,
      listenedSec: 300,
      lastPlayedAt: 2_000,
    });
  });
});

function aggregateCache(devicePublicId: string, playCount: number, listenedSec: number) {
  return {
    schema: "muzero-r2-playback-aggregate-v1",
    devicePublicId,
    updatedAt: 2_000,
    aggregates: [
      {
        id: `${devicePublicId}:track:trk_remote`,
        scope: "track",
        remoteTrackId: "trk_remote",
        playCount,
        listenedSec,
        lastPlayedAt: 2_000,
        updatedAt: 2_000,
      },
    ],
  };
}

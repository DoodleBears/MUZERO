import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { recordPlaybackListen, shouldCountAsPlay } from "./playback-stats";

let db: MuzeroDB;
let dbName: string;

beforeEach(async () => {
  dbName = `muzero-playback-stats-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
  await db.tracks.put(track("trk_1"));
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("shouldCountAsPlay", () => {
  it("counts a listen after 30 seconds or half the track for short media", () => {
    expect(shouldCountAsPlay({ listenedSec: 29, durationSec: 180 })).toBe(false);
    expect(shouldCountAsPlay({ listenedSec: 30, durationSec: 180 })).toBe(true);
    expect(shouldCountAsPlay({ listenedSec: 12, durationSec: 20 })).toBe(true);
  });
});

describe("recordPlaybackListen", () => {
  it("persists playback event, per-track stats, aggregate, and track play count", async () => {
    const event = await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        durationSec: 180,
        listenedSec: 31,
        startedAt: 1000,
        endedAt: 31_000,
        context: { source: "local", setId: "ses_1" },
      },
      db,
    );

    expect(event.countedAsPlay).toBe(true);
    expect(await db.playbackEvents.count()).toBe(1);
    expect(await db.trackPlaybackStats.get("dvc_1:trk_1")).toMatchObject({
      playCount: 1,
      listenedSec: 31,
      lastPlayedAt: 31_000,
    });
    expect(await db.playbackAggregates.get("dvc_1:track:trk_1")).toMatchObject({
      scope: "track",
      playCount: 1,
      listenedSec: 31,
    });
    expect((await db.tracks.get("trk_1"))?.playCount).toBe(1);
  });

  it("adds listened seconds without incrementing play count for short listens", async () => {
    await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        durationSec: 180,
        listenedSec: 5,
        startedAt: 1000,
        endedAt: 6000,
        context: { source: "local", setId: "ses_1" },
      },
      db,
    );

    expect(await db.trackPlaybackStats.get("dvc_1:trk_1")).toMatchObject({
      playCount: 0,
      listenedSec: 5,
    });
    expect((await db.tracks.get("trk_1"))?.playCount).toBe(0);
  });
});

function track(id: string): Track {
  return {
    id,
    sessionId: "ses_1",
    title: "Blue Avenue",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    blobId: "blb_1",
    createdAt: 100,
    playCount: 0,
    liked: false,
    tags: [],
  };
}

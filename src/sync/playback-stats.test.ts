import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { summarizePlaybackAggregates } from "./playback-aggregate-summary";
import {
  derivePlaybackAggregatesFromEvents,
  rebuildPlaybackAggregatesFromEvents,
  reconcileTrackPlayCountsFromStats,
  recordPlaybackListen,
  shouldCountAsPlay,
} from "./playback-stats";

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

  it("derives track-in-set aggregates separately from global track aggregates", async () => {
    await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        durationSec: 180,
        listenedSec: 31,
        startedAt: 1000,
        endedAt: 31_000,
        context: { source: "local", setId: "ses_a" },
      },
      db,
    );
    await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        durationSec: 180,
        listenedSec: 5,
        startedAt: 40_000,
        endedAt: 45_000,
        context: { source: "local", setId: "ses_b" },
      },
      db,
    );

    expect(await db.playbackAggregates.get("dvc_1:track:trk_1")).toMatchObject({
      scope: "track",
      playCount: 1,
      listenedSec: 36,
    });
    expect(await db.playbackAggregates.get("dvc_1:track-in-set:ses_a:trk_1")).toMatchObject({
      scope: "track-in-set",
      setId: "ses_a",
      trackId: "trk_1",
      playCount: 1,
      listenedSec: 31,
    });
    expect(await db.playbackAggregates.get("dvc_1:track-in-set:ses_b:trk_1")).toMatchObject({
      scope: "track-in-set",
      setId: "ses_b",
      trackId: "trk_1",
      playCount: 0,
      listenedSec: 5,
    });
  });

  it("derives track-in-share, share, and drive aggregates for shared remote listens", async () => {
    const event = await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        remoteTrackRef: {
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
          trackId: "remote_trk_1",
          mediaSha256: "sha256-blue",
        },
        durationSec: 180,
        listenedSec: 31,
        startedAt: 1000,
        endedAt: 31_000,
        context: {
          source: "shared-drive",
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
        },
      },
      db,
    );

    expect(event.remoteTrackRef).toMatchObject({ trackId: "remote_trk_1" });
    expect(
      await db.playbackAggregates.get("dvc_1:track-in-share:shr_tokyo:remote_trk_1"),
    ).toMatchObject({
      scope: "track-in-share",
      shareId: "shr_tokyo",
      setId: "ses_tokyo",
      trackId: "trk_1",
      remoteTrackId: "remote_trk_1",
      mediaSha256: "sha256-blue",
      playCount: 1,
      listenedSec: 31,
    });
    expect(await db.playbackAggregates.get("dvc_1:share:shr_tokyo")).toMatchObject({
      scope: "share",
      shareId: "shr_tokyo",
      playCount: 1,
      listenedSec: 31,
    });
    expect(await db.playbackAggregates.get("dvc_1:drive:drv_friend")).toMatchObject({
      scope: "drive",
      driveId: "drv_friend",
      playCount: 1,
      listenedSec: 31,
    });
  });

  it("records stats for a shared remote track without importing it locally", async () => {
    const event = await recordPlaybackListen(
      {
        devicePublicId: "dvc_1",
        remoteTrackRef: {
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
          trackId: "remote_trk_1",
          mediaSha256: "sha256-blue",
        },
        durationSec: 180,
        listenedSec: 31,
        startedAt: 1000,
        endedAt: 31_000,
        context: {
          source: "shared-drive",
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
        },
      },
      db,
    );

    expect(event.trackId).toBeUndefined();
    expect(event.remoteTrackRef?.trackId).toBe("remote_trk_1");
    expect(await db.trackPlaybackStats.count()).toBe(0);
    expect(await db.playbackAggregates.get("dvc_1:track:remote_trk_1")).toMatchObject({
      scope: "track",
      remoteTrackId: "remote_trk_1",
      mediaSha256: "sha256-blue",
      playCount: 1,
      listenedSec: 31,
    });
    expect(
      await db.playbackAggregates.get("dvc_1:track-in-share:shr_tokyo:remote_trk_1"),
    ).toMatchObject({
      scope: "track-in-share",
      shareId: "shr_tokyo",
      remoteTrackId: "remote_trk_1",
    });
  });

  it("persists playback stats across database reloads", async () => {
    await recordPlaybackListen(
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

    db.close();
    db = new MuzeroDB(dbName);

    expect(await db.playbackEvents.count()).toBe(1);
    expect(await db.trackPlaybackStats.get("dvc_1:trk_1")).toMatchObject({
      playCount: 1,
      listenedSec: 31,
    });
    expect(await db.playbackAggregates.get("dvc_1:track:trk_1")).toMatchObject({
      playCount: 1,
      listenedSec: 31,
    });
  });

  it("keeps a large shared playlist separated across many anonymous devices", () => {
    const events = Array.from({ length: 100 }, (_, index) => ({
      id: `ple_${index}`,
      devicePublicId: `dvc_${index.toString().padStart(3, "0")}`,
      remoteTrackRef: {
        driveId: "drv_friend",
        shareId: "shr_tokyo",
        setId: "ses_tokyo",
        trackId: "remote_trk_1",
        mediaSha256: "sha256-blue",
      },
      context: {
        source: "shared-drive" as const,
        driveId: "drv_friend",
        shareId: "shr_tokyo",
        setId: "ses_tokyo",
      },
      startedAt: 1_000 + index,
      endedAt: 31_000 + index,
      listenedSec: 31,
      countedAsPlay: true,
    }));

    const aggregates = derivePlaybackAggregatesFromEvents(events);
    const trackInShareRows = aggregates.filter(
      (aggregate) =>
        aggregate.scope === "track-in-share" &&
        aggregate.shareId === "shr_tokyo" &&
        aggregate.remoteTrackId === "remote_trk_1",
    );

    expect(trackInShareRows).toHaveLength(100);
    expect(new Set(trackInShareRows.map((row) => row.devicePublicId)).size).toBe(100);
    expect(new Set(trackInShareRows.map((row) => row.id)).size).toBe(100);
    expect(
      summarizePlaybackAggregates(aggregates, {
        scope: "track-in-share",
        shareId: "shr_tokyo",
        remoteTrackId: "remote_trk_1",
      }),
    ).toMatchObject({
      deviceCount: 100,
      listenedSec: 3_100,
      playCount: 100,
    });
  });
});

describe("rebuildPlaybackAggregatesFromEvents", () => {
  it("rebuilds aggregate rows from event segments without duplicating play counts", async () => {
    const events = [
      {
        id: "ple_1",
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        context: { source: "local" as const, setId: "ses_1" },
        startedAt: 1000,
        endedAt: 31_000,
        listenedSec: 31,
        countedAsPlay: true,
      },
      {
        id: "ple_2",
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        context: { source: "local" as const, setId: "ses_1" },
        startedAt: 40_000,
        endedAt: 45_000,
        listenedSec: 5,
        countedAsPlay: false,
      },
    ];
    await db.playbackAggregates.put({
      id: "dvc_1:track:trk_1",
      devicePublicId: "dvc_1",
      scope: "track",
      trackId: "trk_1",
      playCount: 99,
      listenedSec: 999,
      updatedAt: 1,
    });

    await rebuildPlaybackAggregatesFromEvents("dvc_1", events, db);
    await rebuildPlaybackAggregatesFromEvents("dvc_1", events, db);

    expect(await db.playbackAggregates.get("dvc_1:track:trk_1")).toMatchObject({
      playCount: 1,
      listenedSec: 36,
      lastPlayedAt: 31_000,
      updatedAt: 45_000,
    });
    expect(await db.playbackAggregates.get("dvc_1:track-in-set:ses_1:trk_1")).toMatchObject({
      scope: "track-in-set",
      playCount: 1,
      listenedSec: 36,
    });
  });

  it("derives shared-drive aggregate scopes from remote event refs", () => {
    const aggregates = derivePlaybackAggregatesFromEvents([
      {
        id: "ple_remote",
        devicePublicId: "dvc_1",
        trackId: "trk_local",
        remoteTrackRef: {
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
          trackId: "remote_trk_1",
          mediaSha256: "sha256-blue",
        },
        context: {
          source: "shared-drive",
          driveId: "drv_friend",
          shareId: "shr_tokyo",
          setId: "ses_tokyo",
        },
        startedAt: 1000,
        endedAt: 31_000,
        listenedSec: 31,
        countedAsPlay: true,
      },
    ]);

    expect(aggregates.map((aggregate) => aggregate.id).sort()).toEqual([
      "dvc_1:drive:drv_friend",
      "dvc_1:set:ses_tokyo",
      "dvc_1:share:shr_tokyo",
      "dvc_1:track-in-set:ses_tokyo:trk_local",
      "dvc_1:track-in-share:shr_tokyo:remote_trk_1",
      "dvc_1:track:trk_local",
    ]);
  });
});

describe("reconcileTrackPlayCountsFromStats", () => {
  it("rebuilds Track.playCount from per-device track stats", async () => {
    await db.tracks.update("trk_1", { playCount: 99 });
    await db.tracks.put(track("trk_2"));
    await db.trackPlaybackStats.bulkPut([
      {
        id: "dvc_a:trk_1",
        devicePublicId: "dvc_a",
        trackId: "trk_1",
        playCount: 2,
        listenedSec: 120,
        updatedAt: 1000,
      },
      {
        id: "dvc_b:trk_1",
        devicePublicId: "dvc_b",
        trackId: "trk_1",
        playCount: 3,
        listenedSec: 180,
        updatedAt: 2000,
      },
    ]);

    const result = await reconcileTrackPlayCountsFromStats(db);

    expect(result).toEqual({ checked: 2, updated: 1 });
    expect((await db.tracks.get("trk_1"))?.playCount).toBe(5);
    expect((await db.tracks.get("trk_2"))?.playCount).toBe(0);
  });

  it("can preserve legacy playCount when no per-device stats exist", async () => {
    await db.tracks.update("trk_1", { playCount: 7 });

    const result = await reconcileTrackPlayCountsFromStats(db, { zeroMissingStats: false });

    expect(result).toEqual({ checked: 1, updated: 0 });
    expect((await db.tracks.get("trk_1"))?.playCount).toBe(7);
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

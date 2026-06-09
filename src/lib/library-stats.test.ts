import { describe, expect, it } from "vitest";
import type { Track, TrackMediaMetadata, TrackPlaybackStats } from "@/db/types";
import { buildArtistIndex } from "./library-index";
import { buildTrackStatsMap, deriveEntityStats, statFor } from "./library-stats";
import { formatListenTime } from "./utils";

function track(partial: Partial<Track>): Track {
  return {
    id: "t",
    sessionId: "s",
    title: "Untitled",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 30,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}
const md = (p: Partial<TrackMediaMetadata>): TrackMediaMetadata => ({
  parser: "music-metadata",
  parsedAt: 1,
  ...p,
});
const stat = (trackId: string, listenedSec: number, playCount: number): TrackPlaybackStats => ({
  id: `dev:${trackId}`,
  devicePublicId: "dev",
  trackId,
  listenedSec,
  playCount,
  updatedAt: 0,
});

describe("buildTrackStatsMap", () => {
  it("sums multiple device rows per track", () => {
    const map = buildTrackStatsMap([stat("a", 100, 1), stat("a", 50, 1), stat("b", 30, 1)]);
    expect(map.get("a")).toMatchObject({ listenedSec: 150, playCount: 2 });
    expect(map.get("b")).toMatchObject({ listenedSec: 30, playCount: 1 });
  });
});

describe("deriveEntityStats", () => {
  it("credits each artist of a collaboration", () => {
    const tracks = [
      track({ id: "1", mediaMetadata: md({ artists: ["Alpha", "Beta"] }) }),
      track({ id: "2", mediaMetadata: md({ artists: ["Alpha"] }) }),
    ];
    const artists = buildArtistIndex(tracks);
    const stats = deriveEntityStats(
      artists,
      buildTrackStatsMap([stat("1", 200, 1), stat("2", 100, 1)]),
    );
    // Alpha: track1 (200) + track2 (100) = 300, 2 plays
    expect(statFor(stats, "alpha")).toMatchObject({ listenedSec: 300, playCount: 2 });
    // Beta: only track1 = 200, 1 play
    expect(statFor(stats, "beta")).toMatchObject({ listenedSec: 200, playCount: 1 });
  });

  it("re-tagging moves accumulated time (current-truth)", () => {
    const stats = buildTrackStatsMap([stat("1", 120, 1)]);
    const before = deriveEntityStats(
      buildArtistIndex([track({ id: "1", mediaMetadata: md({ artists: ["Old Name"] }) })]),
      stats,
    );
    expect(statFor(before, "old name").listenedSec).toBe(120);
    // Same track, edited tag → re-folded under the new key, old key gone.
    const after = deriveEntityStats(
      buildArtistIndex([track({ id: "1", mediaMetadata: md({ artists: ["New Name"] }) })]),
      stats,
    );
    expect(statFor(after, "new name").listenedSec).toBe(120);
    expect(after.has("old name")).toBe(false);
  });

  it("zeroes entities with no plays", () => {
    const stats = deriveEntityStats(
      buildArtistIndex([track({ id: "1", mediaMetadata: md({ artists: ["Silent"] }) })]),
      new Map(),
    );
    expect(statFor(stats, "silent")).toMatchObject({ listenedSec: 0, playCount: 0 });
  });
});

describe("formatListenTime", () => {
  it("formats coarse cumulative time", () => {
    expect(formatListenTime(45)).toBe("45s");
    expect(formatListenTime(12 * 60)).toBe("12m");
    expect(formatListenTime(4 * 3600 + 12 * 60)).toBe("4h 12m");
    expect(formatListenTime(-5)).toBe("0s");
  });
});

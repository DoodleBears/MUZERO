import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { buildLyricsQuery, buildLyricsQueryPlan } from "./build-query";
import type { LyricsQuery } from "./provider";

function track(over: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Blue Highway",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 214,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    mediaMetadata: {
      artists: ["Deidian"],
      album: "Moonstone Beach",
      parser: "music-metadata",
      parsedAt: 0,
    },
    ...over,
  };
}

describe("buildLyricsQuery", () => {
  it("builds a query from title, artist, album and duration", () => {
    expect(buildLyricsQuery(track())).toEqual({
      trackName: "Blue Highway",
      artistName: "Deidian",
      albumName: "Moonstone Beach",
      durationSec: 214,
    });
  });

  it("joins multiple artists", () => {
    const q = buildLyricsQuery(
      track({ mediaMetadata: { artists: ["A", "B"], parser: "manual", parsedAt: 0 } }),
    );
    expect(q?.artistName).toBe("A, B");
  });

  it("returns null when there is no artist (e.g. generated brief-only track)", () => {
    expect(buildLyricsQuery(track({ mediaMetadata: undefined }))).toBeNull();
  });

  it("returns null when the title is blank", () => {
    expect(buildLyricsQuery(track({ title: "   " }))).toBeNull();
  });

  it("omits a non-positive duration", () => {
    const q = buildLyricsQuery(track({ durationSec: 0 }));
    expect(q?.durationSec).toBeUndefined();
  });

  it("carries the NetEase songId for streamed NetEase tracks", () => {
    const q = buildLyricsQuery(
      track({ origin: "streamed", streamSourceId: "netease", streamExternalId: "33894312" }),
    );
    expect(q?.neteaseSongId).toBe("33894312");
  });

  it("still builds a query for a NetEase track even without artist (songId is enough)", () => {
    const q = buildLyricsQuery(
      track({
        origin: "streamed",
        streamSourceId: "netease",
        streamExternalId: "999",
        mediaMetadata: undefined,
      }),
    );
    expect(q).not.toBeNull();
    expect(q?.neteaseSongId).toBe("999");
  });

  it("does not set a songId for non-NetEase streamed tracks", () => {
    const q = buildLyricsQuery(
      track({ origin: "streamed", streamSourceId: "bili", streamExternalId: "BV1#1" }),
    );
    expect(q?.neteaseSongId).toBeUndefined();
  });
});

describe("buildLyricsQueryPlan", () => {
  it("keeps the primary query verbatim", () => {
    const q: LyricsQuery = {
      trackName: "Song (Live)",
      artistName: "A, B",
      albumName: "Album",
      durationSec: 200,
    };
    expect(buildLyricsQueryPlan(q).primary).toEqual(q);
  });

  it("derives a normalized variant (clean title + primary artist), keeping album/duration", () => {
    const plan = buildLyricsQueryPlan({
      trackName: "Song (Live)",
      artistName: "A, B & C",
      albumName: "Album",
      durationSec: 200,
    });
    expect(plan.normalized).toEqual({
      trackName: "Song",
      artistName: "A",
      albumName: "Album",
      durationSec: 200,
    });
    expect(plan.normalizedDiffers).toBe(true);
  });

  it("marks normalizedDiffers false when nothing changes (avoids a redundant L1 request)", () => {
    const plan = buildLyricsQueryPlan({ trackName: "Clean", artistName: "Solo", durationSec: 120 });
    expect(plan.normalizedDiffers).toBe(false);
    expect(plan.normalized.trackName).toBe("Clean");
    expect(plan.normalized.artistName).toBe("Solo");
  });
});

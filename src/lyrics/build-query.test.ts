import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { buildLyricsQuery } from "./build-query";

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
});

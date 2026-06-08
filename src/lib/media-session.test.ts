import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { buildMediaSessionMetadataInit, setPlatformMediaSessionMetadata } from "./media-session";

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Filename Fallback",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    ...overrides,
  };
}

describe("buildMediaSessionMetadataInit", () => {
  it("prefers imported title, artist, album, and artwork", () => {
    expect(
      buildMediaSessionMetadataInit(
        track({
          mediaMetadata: {
            title: "Moonstone Beach",
            artists: ["Deidian", "Soluna"],
            album: "Soluna Music",
            parser: "music-metadata",
            parsedAt: 1,
          },
        }),
        { src: "blob:cover", mime: "image/jpeg" },
      ),
    ).toEqual({
      title: "Moonstone Beach",
      artist: "Deidian, Soluna",
      album: "Soluna Music",
      artwork: [{ src: "blob:cover", type: "image/jpeg" }],
    });
  });

  it("falls back to track identity when imported tags are sparse", () => {
    expect(buildMediaSessionMetadataInit(track())).toEqual({
      title: "Filename Fallback",
    });
  });
});

describe("setPlatformMediaSessionMetadata", () => {
  it("sets MediaMetadata when the platform exposes Media Session", () => {
    const target = {
      navigator: { mediaSession: { metadata: null } },
      MediaMetadata: class {
        constructor(readonly init?: MediaMetadataInit) {}
      },
    };

    expect(setPlatformMediaSessionMetadata(track(), undefined, target)).toBe(true);
    expect(target.navigator.mediaSession.metadata).toMatchObject({
      init: { title: "Filename Fallback" },
    });
  });

  it("returns false without throwing when Media Session is unsupported", () => {
    expect(setPlatformMediaSessionMetadata(track(), undefined, {})).toBe(false);
  });
});

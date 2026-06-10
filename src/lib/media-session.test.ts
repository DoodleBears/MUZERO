import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import {
  buildMediaSessionMetadataInit,
  setPlatformMediaSessionActionHandlers,
  setPlatformMediaSessionMetadata,
  setPlatformMediaSessionPlaybackState,
} from "./media-session";

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

describe("setPlatformMediaSessionActionHandlers", () => {
  it("registers transport handlers and clears unset actions", () => {
    const handlers: Record<string, (() => void) | null> = {};
    const target = {
      navigator: {
        mediaSession: {
          metadata: null,
          setActionHandler(action: string, handler: (() => void) | null) {
            handlers[action] = handler;
          },
        },
      },
    };
    const next = vi.fn();

    expect(setPlatformMediaSessionActionHandlers({ nexttrack: next }, target)).toBe(true);
    handlers.nexttrack?.();
    expect(next).toHaveBeenCalledOnce();
    // previoustrack/play/pause weren't provided → registered as null, not left stale.
    expect(handlers.previoustrack).toBeNull();
    expect(handlers.play).toBeNull();
  });

  it("ignores actions the platform rejects", () => {
    const target = {
      navigator: {
        mediaSession: {
          metadata: null,
          setActionHandler(action: string) {
            if (action === "previoustrack") throw new TypeError("unsupported action");
          },
        },
      },
    };
    expect(() =>
      setPlatformMediaSessionActionHandlers(
        { previoustrack: () => {}, nexttrack: () => {} },
        target,
      ),
    ).not.toThrow();
  });

  it("returns false when action handlers are unsupported", () => {
    expect(setPlatformMediaSessionActionHandlers({ nexttrack: () => {} }, {})).toBe(false);
    expect(
      setPlatformMediaSessionActionHandlers(
        { nexttrack: () => {} },
        { navigator: { mediaSession: { metadata: null } } },
      ),
    ).toBe(false);
  });
});

describe("setPlatformMediaSessionPlaybackState", () => {
  it("mirrors playback state when supported", () => {
    const target = {
      navigator: {
        mediaSession: { metadata: null, playbackState: "none" as MediaSessionPlaybackState },
      },
    };
    expect(setPlatformMediaSessionPlaybackState("playing", target)).toBe(true);
    expect(target.navigator.mediaSession.playbackState).toBe("playing");
  });

  it("returns false when Media Session is unsupported", () => {
    expect(setPlatformMediaSessionPlaybackState("playing", {})).toBe(false);
  });
});

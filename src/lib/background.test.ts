import { describe, expect, it } from "vitest";
import type { TrackKind, TrackStatus } from "@/db/types";
import {
  type BackgroundRenderTarget,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
  settleBackgroundTarget,
  trackHasBackgroundVideoMedia,
} from "./background";
import { trackIsPlayableVideo } from "./track-display";

describe("resolveBackgroundSource", () => {
  it("cover priority: the cover wins when present", () => {
    expect(
      resolveBackgroundSource({
        mode: "cover",
        hasCover: true,
        trackBackgroundCount: 3,
        galleryCount: 5,
      }),
    ).toBe("cover");
  });

  it("cover priority: falls to the track's own slideshow when there's no cover", () => {
    expect(
      resolveBackgroundSource({
        mode: "cover",
        hasCover: false,
        trackBackgroundCount: 2,
        galleryCount: 5,
      }),
    ).toBe("track-slideshow");
  });

  it("slideshow priority: the track's own slideshow wins over its cover", () => {
    expect(
      resolveBackgroundSource({
        mode: "slideshow",
        hasCover: true,
        trackBackgroundCount: 2,
        galleryCount: 9,
      }),
    ).toBe("track-slideshow");
  });

  it("slideshow priority: falls to the cover when the track has no slideshow", () => {
    expect(
      resolveBackgroundSource({
        mode: "slideshow",
        hasCover: true,
        trackBackgroundCount: 0,
        galleryCount: 9,
      }),
    ).toBe("cover");
  });

  it("never borrows the gallery while the track still has its own cover/slideshow", () => {
    expect(
      resolveBackgroundSource({
        mode: "cover",
        hasCover: true,
        trackBackgroundCount: 0,
        galleryCount: 9,
      }),
    ).toBe("cover");
  });

  it("falls back to the global gallery only when the track has neither cover nor slideshow", () => {
    for (const mode of ["cover", "slideshow"] as const) {
      expect(
        resolveBackgroundSource({
          mode,
          hasCover: false,
          trackBackgroundCount: 0,
          galleryCount: 4,
        }),
      ).toBe("gallery-slideshow");
    }
  });

  it("galleryFallback off: shows nothing instead of the global gallery", () => {
    expect(
      resolveBackgroundSource({
        mode: "slideshow",
        galleryFallback: false,
        hasCover: false,
        trackBackgroundCount: 0,
        galleryCount: 4,
      }),
    ).toBe("none");
  });

  it("galleryFallback defaults to on when omitted", () => {
    expect(
      resolveBackgroundSource({
        mode: "cover",
        hasCover: false,
        trackBackgroundCount: 0,
        galleryCount: 4,
      }),
    ).toBe("gallery-slideshow");
  });

  it("shows nothing when there are no images at all", () => {
    expect(
      resolveBackgroundSource({
        mode: "slideshow",
        hasCover: false,
        trackBackgroundCount: 0,
        galleryCount: 0,
      }),
    ).toBe("none");
  });

  it("none: shows nothing even when a cover, slideshow, and gallery all exist", () => {
    expect(
      resolveBackgroundSource({
        mode: "none",
        hasCover: true,
        trackBackgroundCount: 3,
        galleryCount: 5,
      }),
    ).toBe("none");
  });

  it("treats an undefined mode as cover priority", () => {
    expect(
      resolveBackgroundSource({
        mode: undefined,
        hasCover: true,
        trackBackgroundCount: 5,
        galleryCount: 5,
      }),
    ).toBe("cover");
  });
});

describe("resolvePixiBackgroundMedia", () => {
  it("uses the current ready video track as the Pixi source", () => {
    expect(
      resolvePixiBackgroundMedia({
        imageSource: "cover",
        trackKind: "video",
        trackStatus: "ready",
        hasTrackMedia: true,
      }),
    ).toEqual({ source: "track-video", mediaType: "video" });
  });

  it("none mode suppresses the MV backdrop even for a ready video track", () => {
    expect(
      resolvePixiBackgroundMedia({
        imageSource: "none",
        mode: "none",
        trackKind: "video",
        trackStatus: "ready",
        hasTrackMedia: true,
      }),
    ).toEqual({ source: "none", mediaType: "image" });
  });

  it("keeps image sources for audio, pending video, or missing media", () => {
    expect(
      resolvePixiBackgroundMedia({
        imageSource: "track-slideshow",
        trackKind: "audio",
        trackStatus: "ready",
        hasTrackMedia: true,
      }),
    ).toEqual({ source: "track-slideshow", mediaType: "image" });
    expect(
      resolvePixiBackgroundMedia({
        imageSource: "cover",
        trackKind: "video",
        trackStatus: "generating",
        hasTrackMedia: true,
      }),
    ).toEqual({ source: "cover", mediaType: "image" });
    expect(
      resolvePixiBackgroundMedia({
        imageSource: "gallery-slideshow",
        trackKind: "video",
        trackStatus: "ready",
        hasTrackMedia: false,
      }),
    ).toEqual({ source: "gallery-slideshow", mediaType: "image" });
  });
});

describe("front/back video-gate parity (single source of truth)", () => {
  const kinds: TrackKind[] = ["audio", "video"];
  const statuses: TrackStatus[] = ["pending", "generating", "ready", "failed"];

  it("the Pixi background plays a video iff trackIsPlayableVideo — same gate as the stage", () => {
    for (const trackKind of kinds) {
      for (const trackStatus of statuses) {
        const pixiVideo =
          resolvePixiBackgroundMedia({
            imageSource: "cover",
            trackKind,
            trackStatus,
            hasTrackMedia: true,
          }).source === "track-video";
        // The foreground stage shows video iff trackIsPlayableVideo (Phase 1). The
        // background MUST agree, or one plays a video while the other shows a cover.
        expect(pixiVideo).toBe(trackIsPlayableVideo({ kind: trackKind, status: trackStatus }));
      }
    }
  });

  it("background video media gate also keys on trackIsPlayableVideo", () => {
    for (const trackKind of kinds) {
      for (const trackStatus of statuses) {
        const hasBg = trackHasBackgroundVideoMedia({
          blobId: "blb_mv",
          kind: trackKind,
          remoteMediaUrl: undefined,
          status: trackStatus,
        });
        // With media present, background-capable iff it's a playable video.
        expect(hasBg).toBe(trackIsPlayableVideo({ kind: trackKind, status: trackStatus }));
      }
    }
  });
});

describe("trackHasBackgroundVideoMedia", () => {
  it("treats a referenced local-file MV as background-capable", () => {
    expect(
      trackHasBackgroundVideoMedia({
        blobId: undefined,
        kind: "video",
        remoteMediaUrl: undefined,
        sourcePath: "D:/media/live-show.mkv",
        status: "ready",
      }),
    ).toBe(true);
  });

  it("treats a remote-only R2 MV as background-capable", () => {
    expect(
      trackHasBackgroundVideoMedia({
        blobId: undefined,
        kind: "video",
        remoteMediaUrl: "https://pub.example.com/muzero/objects/media/mv.mp4",
        status: "ready",
      }),
    ).toBe(true);
  });

  it("requires a ready video track with local or remote media", () => {
    expect(
      trackHasBackgroundVideoMedia({
        blobId: undefined,
        kind: "video",
        remoteMediaUrl: undefined,
        status: "ready",
      }),
    ).toBe(false);
    expect(
      trackHasBackgroundVideoMedia({
        blobId: "blb_mv",
        kind: "video",
        remoteMediaUrl: undefined,
        status: "generating",
      }),
    ).toBe(false);
    expect(
      trackHasBackgroundVideoMedia({
        blobId: undefined,
        kind: "audio",
        remoteMediaUrl: "https://pub.example.com/muzero/objects/media/song.mp3",
        status: "ready",
      }),
    ).toBe(false);
  });
});

describe("settleBackgroundTarget", () => {
  it("keeps the painted background while the next source is resolving", () => {
    const current = { mediaType: "image", src: "blob:cover-a" } as const;

    expect(settleBackgroundTarget(current, null, true)).toBe(current);
  });

  it("switches to the next target once its URL is ready", () => {
    const current: BackgroundRenderTarget = { mediaType: "image", src: "blob:cover-a" };
    const next: BackgroundRenderTarget = { mediaType: "image", src: "blob:cover-b" };

    expect(settleBackgroundTarget(current, next, true)).toBe(next);
  });

  it("clears the painted background when there is no pending source", () => {
    const current = { mediaType: "image", src: "blob:cover-a" } as const;

    expect(settleBackgroundTarget(current, null, false)).toBeNull();
  });
});

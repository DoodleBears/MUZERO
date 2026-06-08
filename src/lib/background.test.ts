import { describe, expect, it } from "vitest";
import {
  type BackgroundRenderTarget,
  resolveBackgroundSource,
  resolvePixiBackgroundMedia,
  settleBackgroundTarget,
} from "./background";

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

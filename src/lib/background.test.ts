import { describe, expect, it } from "vitest";
import { resolveBackgroundSource } from "./background";

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

import { describe, expect, it } from "vitest";
import { rendererKindFor, resolveBackgroundFrameSpec } from "./background-frame";

const base = {
  trackId: "trk_1",
  galleryFallback: true,
  trackBackgroundCount: 0,
  galleryCount: 0,
  hasTrackVideo: false,
} as const;

describe("rendererKindFor", () => {
  it("maps blur → blur, the pixi effects → pixi, everything else → plain", () => {
    expect(rendererKindFor("blur")).toBe("blur");
    for (const r of ["pixel", "ascii", "cross-hatch", "crt", "dot", "noise"]) {
      expect(rendererKindFor(r)).toBe("pixi");
    }
    expect(rendererKindFor("image")).toBe("plain");
    expect(rendererKindFor(undefined)).toBe("plain");
  });
});

describe("resolveBackgroundFrameSpec", () => {
  it("cover + blur → image cover, blur renderer", () => {
    expect(
      resolveBackgroundFrameSpec({ ...base, mode: "cover", renderer: "blur", hasCover: true }),
    ).toEqual({ trackId: "trk_1", source: "cover", mediaType: "image", rendererKind: "blur" });
  });

  it("cover + noise → cover, pixi renderer", () => {
    expect(
      resolveBackgroundFrameSpec({ ...base, mode: "cover", renderer: "noise", hasCover: true }),
    ).toMatchObject({ source: "cover", rendererKind: "pixi", mediaType: "image" });
  });

  it("a ready video track on a pixi renderer textures the MV as the background", () => {
    expect(
      resolveBackgroundFrameSpec({
        ...base,
        mode: "cover",
        renderer: "noise",
        hasCover: true,
        trackKind: "video",
        trackStatus: "ready",
        hasTrackVideo: true,
      }),
    ).toMatchObject({ source: "track-video", mediaType: "video", rendererKind: "pixi" });
  });

  it("the same video track on the blur renderer uses Pixi so the MV itself is blurred", () => {
    expect(
      resolveBackgroundFrameSpec({
        ...base,
        mode: "cover",
        renderer: "blur",
        hasCover: true,
        trackKind: "video",
        trackStatus: "ready",
        hasTrackVideo: true,
      }),
    ).toMatchObject({ source: "track-video", mediaType: "video", rendererKind: "pixi" });
  });

  it("mode none → no ambient source", () => {
    expect(
      resolveBackgroundFrameSpec({ ...base, mode: "none", renderer: "noise", hasCover: true }),
    ).toMatchObject({ source: "none" });
  });

  it("no cover but a bound slideshow → track-slideshow", () => {
    expect(
      resolveBackgroundFrameSpec({
        ...base,
        mode: "cover",
        renderer: "blur",
        hasCover: false,
        trackBackgroundCount: 3,
      }),
    ).toMatchObject({ source: "track-slideshow" });
  });
});

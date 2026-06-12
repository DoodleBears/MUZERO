import { describe, expect, it } from "vitest";
import {
  LYRICS_MOTION_MODES,
  type LyricsMotionMode,
  lyricFollowTargetScrollTop,
  resolveLyricsMotionMode,
} from "./lyric-motion";

describe("resolveLyricsMotionMode", () => {
  it("defaults to classic for empty or invalid settings", () => {
    expect(resolveLyricsMotionMode(undefined, { reducedMotion: false }).mode).toBe("classic");
    expect(
      resolveLyricsMotionMode("apple" as LyricsMotionMode, { reducedMotion: false }).mode,
    ).toBe("classic");
  });

  it("exposes the codename-stable mode list", () => {
    expect(LYRICS_MOTION_MODES).toEqual(["classic", "inertial", "cascade"]);
  });

  it("keeps classic as the current low-motion lerp baseline", () => {
    const resolved = resolveLyricsMotionMode("classic", { reducedMotion: false });

    expect(resolved.follow).toMatchObject({
      kind: "lerp",
      anchorRatio: 0.38,
      lerp: 0.16,
    });
    expect(resolved.row).toMatchObject({
      transition: "tween",
      neighborDelayMs: 0,
      residualYPx: 0,
      maxAffectedDistance: 0,
    });
  });

  it("resolves inertial as spring follow without neighbor cascade", () => {
    const resolved = resolveLyricsMotionMode("inertial", { reducedMotion: false });

    expect(resolved.follow.kind).toBe("spring");
    expect(resolved.follow.stiffness).toBeGreaterThan(0);
    expect(resolved.follow.damping).toBeGreaterThan(0);
    expect(resolved.row.transition).toBe("spring");
    expect(resolved.row.neighborDelayMs).toBe(0);
    expect(resolved.row.residualYPx).toBe(0);
  });

  it("resolves cascade as spring follow plus neighbor delay and residual offset", () => {
    const resolved = resolveLyricsMotionMode("cascade", { reducedMotion: false });

    expect(resolved.follow.kind).toBe("spring");
    expect(resolved.row.transition).toBe("spring");
    expect(resolved.row.neighborDelayMs).toBeGreaterThan(0);
    expect(resolved.row.residualYPx).toBeGreaterThan(0);
    expect(resolved.row.maxAffectedDistance).toBeGreaterThan(0);
  });

  it("softens advanced modes under reduced motion", () => {
    const inertial = resolveLyricsMotionMode("inertial", { reducedMotion: true });
    const cascade = resolveLyricsMotionMode("cascade", { reducedMotion: true });

    expect(inertial.mode).toBe("classic");
    expect(cascade.mode).toBe("classic");
    expect(cascade.row.neighborDelayMs).toBe(0);
    expect(cascade.row.residualYPx).toBe(0);
  });
});

describe("lyricFollowTargetScrollTop", () => {
  it("converts the active line center into a scrollTop target at the anchor", () => {
    expect(
      lyricFollowTargetScrollTop({
        scrollTop: 120,
        viewportTop: 100,
        viewportHeight: 500,
        lineTop: 260,
        lineHeight: 40,
        anchorRatio: 0.38,
      }),
    ).toBe(110);
  });

  it("never returns a negative scroll target", () => {
    expect(
      lyricFollowTargetScrollTop({
        scrollTop: 0,
        viewportTop: 100,
        viewportHeight: 500,
        lineTop: 110,
        lineHeight: 20,
        anchorRatio: 0.38,
      }),
    ).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { type BackgroundReadyInputs, isBackgroundFrameReady } from "./background-ready";

const ready: BackgroundReadyInputs = {
  matchesTrack: true,
  pendingProtocolUrl: false,
  mediaUrlReady: true,
  decoded: true,
};

describe("isBackgroundFrameReady", () => {
  it("is ready when the media URL is resolved, matches the track, and is decoded", () => {
    expect(isBackgroundFrameReady(ready)).toBe(true);
  });

  it("holds while the cover resource belongs to a different (stale) track — QA#12-13", () => {
    expect(isBackgroundFrameReady({ ...ready, matchesTrack: false })).toBe(false);
  });

  it("holds while a local-cover protocol URL is still resolving (no blob fallback) — QA#11-13", () => {
    expect(isBackgroundFrameReady({ ...ready, pendingProtocolUrl: true })).toBe(false);
  });

  it("holds until the media URL is resolved (never swap to a blank) — no flash", () => {
    expect(isBackgroundFrameReady({ ...ready, mediaUrlReady: false })).toBe(false);
  });

  it("holds until the image is decoded / texture uploaded (crossfade reveals a painted frame)", () => {
    expect(isBackgroundFrameReady({ ...ready, decoded: false })).toBe(false);
  });

  it("a frame with no media at all (title-only) is ready immediately (nothing to decode)", () => {
    expect(
      isBackgroundFrameReady({
        matchesTrack: true,
        pendingProtocolUrl: false,
        mediaUrlReady: false,
        decoded: false,
        hasMedia: false,
      }),
    ).toBe(true);
  });
});

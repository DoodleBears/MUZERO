import { afterEach, describe, expect, it, vi } from "vitest";
import {
  armNowPlayingSourceCoverMorph,
  getNowPlayingSourceCoverMorphName,
  SOURCE_COVER_MORPH_NAME,
  SOURCE_COVER_MORPH_RESET_MS,
  sourceCoverMorphNamespace,
} from "./source-cover-transition";
import { setViewTransitionSuppressed } from "./view-transition";

const doc = document as unknown as { startViewTransition?: (cb: () => void) => unknown };

function stubStartViewTransition(): void {
  doc.startViewTransition = vi.fn((cb: () => void) => {
    cb();
    return { finished: Promise.resolve(), ready: Promise.resolve() };
  });
}

function stubChromium(): void {
  vi.stubGlobal("navigator", {
    userAgent:
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Electron/28.0.0",
  });
}

afterEach(() => {
  doc.startViewTransition = undefined;
  setViewTransitionSuppressed(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sourceCoverMorphNamespace", () => {
  it("names set, system playlist, and online playlist targets distinctly", () => {
    expect(sourceCoverMorphNamespace({ kind: "set", id: "ses_1" })).toBe("set:ses_1");
    expect(sourceCoverMorphNamespace({ kind: "system-playlist", id: "system:liked" })).toBe(
      "system-playlist:system:liked",
    );
    expect(
      sourceCoverMorphNamespace({
        kind: "online-playlist",
        playlist: { id: "p1", source: "netease" },
      }),
    ).toBe("online-playlist:netease:p1");
  });
});

describe("now playing source cover morph state", () => {
  it("arms the shared cover name on supported unsuppressed view transitions, then clears it", () => {
    vi.useFakeTimers();
    stubStartViewTransition();
    stubChromium();

    armNowPlayingSourceCoverMorph();

    expect(getNowPlayingSourceCoverMorphName()).toBe(SOURCE_COVER_MORPH_NAME);
    vi.advanceTimersByTime(SOURCE_COVER_MORPH_RESET_MS);
    expect(getNowPlayingSourceCoverMorphName()).toBeUndefined();
  });

  it("does not arm when view transitions are suppressed", () => {
    stubStartViewTransition();
    stubChromium();
    setViewTransitionSuppressed(true);

    armNowPlayingSourceCoverMorph();

    expect(getNowPlayingSourceCoverMorphName()).toBeUndefined();
  });
});

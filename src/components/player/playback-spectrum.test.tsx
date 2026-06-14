import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { PlaybackSpectrum, shouldAnimateSpectrum } from "./playback-spectrum";

vi.mock("react-i18next", () => ({
  initReactI18next: { init: () => undefined, type: "3rdParty" },
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("shouldAnimateSpectrum", () => {
  it("animates while playing and settled", () => {
    expect(shouldAnimateSpectrum({ isPlaying: true, dragging: false, switching: false })).toBe(
      true,
    );
  });

  it("does NOT animate while switching, even when playing (Phase 28: pause + fade)", () => {
    expect(shouldAnimateSpectrum({ isPlaying: true, dragging: false, switching: true })).toBe(
      false,
    );
  });

  it("does not animate when idle and settled", () => {
    expect(shouldAnimateSpectrum({ isPlaying: false, dragging: false, switching: false })).toBe(
      false,
    );
  });

  it("always animates during an active seek drag (overrides switching)", () => {
    expect(shouldAnimateSpectrum({ isPlaying: false, dragging: true, switching: true })).toBe(true);
  });
});

describe("PlaybackSpectrum switching fade", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no 2D context; null makes the rAF render loop bail (we only
    // assert the canvas fade, which is pure className state).
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    Object.defineProperty(global, "requestAnimationFrame", {
      configurable: true,
      value: (cb: FrameRequestCallback) => {
        void cb;
        return 1;
      },
      writable: true,
    });
    Object.defineProperty(global, "cancelAnimationFrame", {
      configurable: true,
      value: () => {},
      writable: true,
    });
    usePlayerStore.setState({
      queue: [makeTrack("trk_a"), makeTrack("trk_b")],
      currentIndex: 0,
      isPlaying: true,
      positionSec: 0,
      durationSec: 30,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fades the canvas out while switching tracks and resumes after it settles", async () => {
    const { container } = render(<PlaybackSpectrum />);
    const canvas = () => container.querySelector("canvas");

    // Settled on the initial track → visible.
    expect(canvas()?.className).toContain("opacity-100");

    // Switch to the next track: the id changes before the settle window elapses.
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });
    expect(canvas()?.className).toContain("opacity-0");

    // Once the new track id has been steady for the settle window, it fades back.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });
    expect(canvas()?.className).toContain("opacity-100");
  });
});

function makeTrack(id: string): Track {
  return {
    createdAt: 1,
    durationSec: 30,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: id,
  };
}

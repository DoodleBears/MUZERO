import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedLyrics } from "@/lyrics/resolve-lyrics";
import { LyricsScroller, useActiveLyricLine } from "./synced-lyrics-view";

const engine = vi.hoisted(() => ({ currentSec: 0 }));

vi.mock("react-i18next", () => ({
  initReactI18next: { init: () => undefined, type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "lyrics.source" ? `Lyrics from ${opts?.source}` : key,
  }),
}));

vi.mock("@/stores/player-store", () => ({
  getMediaEngine: () => ({ getCurrentTime: () => engine.currentSec }),
  usePlayerStore: () => undefined,
}));

const synced: ResolvedLyrics = {
  mode: "synced",
  source: "lrclib",
  lines: [
    { timeMs: 1000, text: "line one" },
    { timeMs: 2000, text: "line two" },
    { timeMs: 3000, text: "line three" },
  ],
};

describe("LyricsScroller (synced)", () => {
  it("renders every line", () => {
    render(<LyricsScroller resolved={synced} activeIndex={-1} onSeek={() => {}} />);
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line three")).toBeInTheDocument();
  });

  it("marks the active line", () => {
    render(<LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} />);
    expect(screen.getByText("line one").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("line two").getAttribute("aria-current")).toBeNull();
  });

  it("seeks to a line's start time when clicked", () => {
    const onSeek = vi.fn();
    render(<LyricsScroller resolved={synced} activeIndex={-1} onSeek={onSeek} />);
    fireEvent.click(screen.getByText("line two"));
    expect(onSeek).toHaveBeenCalledWith(2); // 2000ms / 1000
  });

  it("attributes LRCLIB as the source", () => {
    render(<LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} />);
    expect(screen.getByText("Lyrics from LRCLIB")).toBeInTheDocument();
  });
});

describe("LyricsScroller (plain)", () => {
  it("renders plain text and omits LRCLIB attribution for manual lyrics", () => {
    const plain: ResolvedLyrics = { mode: "plain", source: "manual", text: "hello world" };
    render(<LyricsScroller resolved={plain} activeIndex={-1} onSeek={() => {}} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByText(/Lyrics from/)).toBeNull();
  });
});

describe("useActiveLyricLine", () => {
  const lines = [
    { timeMs: 1000, text: "a" },
    { timeMs: 2000, text: "b" },
    { timeMs: 3000, text: "c" },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    engine.currentSec = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks the active line at frame rate while playing", () => {
    const { result } = renderHook(() => useActiveLyricLine(lines, true, -1));
    expect(result.current).toBe(-1); // currentTime 0 → before first line

    act(() => {
      engine.currentSec = 1.5;
      vi.advanceTimersByTime(50); // a few rAF frames
    });
    expect(result.current).toBe(0);

    act(() => {
      engine.currentSec = 2.5;
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe(1);
  });

  it("re-syncs once on a paused seek (no rAF loop)", () => {
    const { result, rerender } = renderHook(
      ({ p }: { p: number }) => useActiveLyricLine(lines, false, p),
      { initialProps: { p: 0 } },
    );
    expect(result.current).toBe(-1);

    act(() => {
      engine.currentSec = 2.5; // a seek moved the engine
      rerender({ p: 2.5 }); // paused-position selector changed → effect re-syncs
    });
    expect(result.current).toBe(1);
  });

  it("returns -1 when there are no lines", () => {
    const { result } = renderHook(() => useActiveLyricLine(null, true, -1));
    expect(result.current).toBe(-1);
  });
});

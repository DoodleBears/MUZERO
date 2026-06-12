import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import type { LyricStyle } from "@/lyrics/lyric-style";
import type { ResolvedLyrics } from "@/lyrics/resolve-lyrics";
import { LyricsScroller, SyncedLyricsView, useActiveLyricLine } from "./synced-lyrics-view";

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

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: unknown, _deps: unknown[], defaultValue: unknown) => defaultValue,
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({
    autoFetchLyrics: false,
    lyricsWordByWord: true,
    lyricsShowTranslation: true,
    lyricsShowRomanization: false,
  }),
}));

vi.mock("@/lib/smooth-scroll/use-smooth-scroll", () => ({
  useSmoothScroll: () => ({ lenisRef: { current: null } }),
}));

vi.mock("@/components/player/visualizer-dynamic-color", () => ({
  useVisualizerCoverColorCss: () => undefined,
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

const customLyricStyle = {
  activeFontSize: 40,
  inactiveFontSize: 20,
  activeOpacity: 0.65,
  inactiveOpacity: 0.22,
  align: "center",
  textShadow: "none",
  textStroke: "",
  lineGap: 12,
} satisfies LyricStyle;

const trackWithoutLyrics: Track = {
  id: "trk_no_lyrics",
  sessionId: "ses_1",
  title: "No Lyrics",
  kind: "audio",
  origin: "uploaded",
  provider: "upload",
  status: "ready",
  durationSec: 120,
  createdAt: 1,
  playCount: 0,
  liked: false,
  tags: [],
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

  it("gives active-size lyric lines enough line-height for descenders", () => {
    render(<LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} />);
    const active = screen.getByText("line one");
    expect(active).toHaveClass("leading-[1.45]");
  });

  it("seeks to a line's start time when clicked", () => {
    const onSeek = vi.fn();
    render(<LyricsScroller resolved={synced} activeIndex={-1} onSeek={onSeek} />);
    fireEvent.click(screen.getByText("line two"));
    expect(onSeek).toHaveBeenCalledWith(2); // 2000ms / 1000
  });

  it("seeks to a line's start time in cascade layout-engine mode", () => {
    const onSeek = vi.fn();
    render(
      <LyricsScroller resolved={synced} activeIndex={0} onSeek={onSeek} motionMode="cascade" />,
    );
    fireEvent.click(screen.getByText("line three"));
    expect(onSeek).toHaveBeenCalledWith(3);
  });

  it("attributes LRCLIB as the source", () => {
    render(<LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} />);
    expect(screen.getByText("Lyrics from LRCLIB")).toBeInTheDocument();
  });

  it("can hide footer affordances for lyrics-only overlays", () => {
    render(
      <LyricsScroller
        resolved={synced}
        activeIndex={0}
        onSeek={() => {}}
        onSearch={() => {}}
        showFooter={false}
      />,
    );

    expect(screen.queryByText("Lyrics from LRCLIB")).toBeNull();
    expect(screen.queryByText("lyrics.wrongLyrics")).toBeNull();
  });

  it("detaches follow on wheel and re-attaches via the return button", () => {
    render(<LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} />);
    // Following by default → no return button.
    expect(screen.queryByLabelText("lyrics.followCurrent")).toBeNull();

    fireEvent.wheel(screen.getByTestId("lyrics-scroll"));
    const back = screen.getByLabelText("lyrics.followCurrent");
    expect(back).toBeInTheDocument();

    fireEvent.click(back);
    expect(screen.queryByLabelText("lyrics.followCurrent")).toBeNull();
  });

  it("applies the selected lyrics motion mode to the synced viewport", () => {
    render(
      <LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} motionMode="inertial" />,
    );

    expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute("data-motion-mode", "inertial");
  });

  it("uses the AMLL-style layout driver for cascade mode", async () => {
    render(
      <LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} motionMode="cascade" />,
    );

    expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute("data-layout-engine", "amll-style");

    await waitFor(() => {
      expect(screen.getByText("line one")).toHaveStyle({
        willChange: "transform, opacity, filter",
      });
    });
    expect(screen.getByText("line one").style.transform).toContain("translate3d");
    expect(screen.getByText("line one").style.filter).toContain("blur");
    expect(screen.getByText("line one")).not.toHaveAttribute("data-cascade-wave-token");
  });

  it("lets cascade detach into readable history scrolling", async () => {
    render(
      <LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} motionMode="cascade" />,
    );

    const viewport = screen.getByTestId("lyrics-scroll");
    await waitFor(() => {
      expect(screen.getByText("line two").style.filter).toContain("blur");
    });
    expect(viewport).toHaveClass("overflow-hidden");

    fireEvent.wheel(viewport);

    expect(screen.getByLabelText("lyrics.followCurrent")).toBeInTheDocument();
    expect(viewport).toHaveClass("overflow-y-auto");
    await waitFor(() => {
      expect(screen.getByText("line two").style.filter).toBe("");
    });
    expect(screen.getByText("line two").style.transform).toBe("");

    fireEvent.click(screen.getByLabelText("lyrics.followCurrent"));
    expect(screen.queryByLabelText("lyrics.followCurrent")).toBeNull();
    await waitFor(() => {
      expect(viewport).toHaveClass("overflow-hidden");
      expect(screen.getByText("line two").style.filter).toContain("blur");
    });
  });

  it("passes cascade tuning to the AMLL-style layout driver", async () => {
    render(
      <LyricsScroller
        resolved={synced}
        activeIndex={0}
        onSeek={() => {}}
        motionMode="cascade"
        cascadeTuning={{ anchorRatio: 0.5, maxBlurPx: 6, staggerMs: 80 }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("line two").style.filter).toBe("blur(2.000px)");
    });
  });

  it("keeps the cascade active line anchored using untransformed row heights", async () => {
    const originalOffsetHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 80;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 500;
      },
    });
    HTMLElement.prototype.getBoundingClientRect = function getScaledRect() {
      return {
        bottom: 20,
        height: 20,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    };
    engine.currentSec = 5.5;
    const longSynced: ResolvedLyrics = {
      mode: "synced",
      source: "lrclib",
      lines: Array.from({ length: 6 }, (_, index) => ({
        timeMs: (index + 1) * 1000,
        text: `line ${index + 1}`,
      })),
    };

    try {
      render(
        <LyricsScroller
          resolved={longSynced}
          activeIndex={4}
          onSeek={() => {}}
          motionMode="cascade"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("line 5").style.transform).toContain("translate3d(0, -182.000px");
      });
    } finally {
      if (originalOffsetHeight) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
      }
      if (originalClientHeight) {
        Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
      }
      HTMLElement.prototype.getBoundingClientRect = originalRect;
      engine.currentSec = 0;
    }
  });

  it("limits cascade per-frame DOM writes to the active lyric neighborhood", async () => {
    engine.currentSec = 21.5;
    const longSynced: ResolvedLyrics = {
      mode: "synced",
      source: "lrclib",
      lines: Array.from({ length: 40 }, (_, index) => ({
        timeMs: (index + 1) * 1000,
        text: `window line ${index + 1}`,
      })),
    };

    try {
      render(
        <LyricsScroller
          resolved={longSynced}
          activeIndex={20}
          onSeek={() => {}}
          motionMode="cascade"
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("window line 21")).toHaveStyle({
          willChange: "transform, opacity, filter",
        });
      });
      expect(screen.getByText("window line 1")).toHaveStyle({ visibility: "hidden" });
      expect(screen.getByText("window line 1").style.willChange).toBe("");
      expect(screen.getByText("window line 40")).toHaveStyle({ visibility: "hidden" });
    } finally {
      engine.currentSec = 0;
    }
  });

  it("keeps cascade effects enabled when the OS prefers reduced motion", async () => {
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }),
    });

    try {
      render(
        <LyricsScroller resolved={synced} activeIndex={0} onSeek={() => {}} motionMode="cascade" />,
      );

      expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute(
        "data-layout-engine",
        "amll-style",
      );
      await waitFor(() => {
        expect(screen.getByText("line one")).toHaveStyle({
          willChange: "transform, opacity, filter",
        });
      });
      expect(screen.getByText("line one").style.filter).toContain("blur");
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
      });
    }
  });

  it("respects custom line spacing in cascade mode", () => {
    render(
      <LyricsScroller
        resolved={synced}
        activeIndex={0}
        onSeek={() => {}}
        motionMode="cascade"
        lyricStyle={{ ...customLyricStyle, lineGap: 12 }}
      />,
    );

    expect(screen.getByTestId("lyrics-stack")).toHaveStyle({ rowGap: "12px" });
  });

  it("respects custom opacity and inactive font size in cascade mode", async () => {
    render(
      <LyricsScroller
        resolved={synced}
        activeIndex={0}
        onSeek={() => {}}
        motionMode="cascade"
        lyricStyle={customLyricStyle}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("line one")).toHaveStyle({ opacity: "0.65" });
    });
    expect(screen.getByText("line two")).toHaveStyle({ opacity: "0.22" });
    expect(screen.getByText("line two").style.transform).toContain("scale(0.5000)");
  });

  it("clears old scroll offset when entering cascade mode", async () => {
    const { rerender } = render(
      <LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} motionMode="classic" />,
    );
    const viewport = screen.getByTestId("lyrics-scroll");
    viewport.scrollTop = 120;

    rerender(
      <LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} motionMode="cascade" />,
    );

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(0);
    });
  });

  it("switches into cascade without the old remount pulse attributes", async () => {
    const { rerender } = render(
      <LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} motionMode="classic" />,
    );

    rerender(
      <LyricsScroller resolved={synced} activeIndex={1} onSeek={() => {}} motionMode="cascade" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute(
        "data-layout-engine",
        "amll-style",
      );
    });
    expect(screen.getByText("line one")).not.toHaveAttribute("data-cascade-affected");
    expect(screen.getByText("line three")).not.toHaveAttribute("data-cascade-initial-y");
  });
});

describe("LyricsScroller (word-by-word karaoke)", () => {
  const wordSynced: ResolvedLyrics = {
    mode: "synced",
    source: "lrclib",
    lines: [
      {
        timeMs: 1000,
        endMs: 2000,
        text: "Cause you",
        words: [
          { timeMs: 1000, durMs: 500, text: "Cause " },
          { timeMs: 1500, durMs: 500, text: "you" },
        ],
      },
      { timeMs: 2000, text: "next line" },
    ],
  };

  it("splits the active line into per-word spans when word timings exist", () => {
    const { container } = render(
      <LyricsScroller resolved={wordSynced} activeIndex={0} onSeek={() => {}} wordByWord />,
    );
    const spans = container.querySelectorAll("[data-word]");
    expect(Array.from(spans).map((s) => s.textContent)).toEqual(["Cause ", "you"]);
    // The non-active line stays whole (no word spans).
    expect(screen.getByText("next line").querySelectorAll("[data-word]").length).toBe(0);
  });

  it("keeps word spans in cascade layout-engine mode", () => {
    const { container } = render(
      <LyricsScroller
        resolved={wordSynced}
        activeIndex={0}
        onSeek={() => {}}
        wordByWord
        motionMode="cascade"
      />,
    );
    expect(Array.from(container.querySelectorAll("[data-word]")).map((s) => s.textContent)).toEqual(
      ["Cause ", "you"],
    );
    expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute("data-layout-engine", "amll-style");
  });

  it("fills word spans with a valid color in the default color mode (no invisible text)", () => {
    // Regression: with lyricStyle.color undefined (default mode), the gradient must
    // fall back to the foreground token — never an "undefined" stop, which background-clip:text
    // would render as fully invisible text.
    const { container } = render(
      <LyricsScroller resolved={wordSynced} activeIndex={0} onSeek={() => {}} wordByWord />,
    );
    const span = container.querySelector("[data-word]") as HTMLElement;
    const style = (span.getAttribute("style") ?? "").toLowerCase();
    expect(span.style.backgroundImage).not.toContain("undefined");
    expect(style).toContain("var(--color-foreground)");
    // The FILL is transparent-ized, but `color` itself must keep inheriting so
    // currentColor resolves to the foreground.
    expect(span.style.color).not.toBe("transparent");
  });

  it("gives karaoke word fill spans vertical bleed so WebKit does not clip glyph paint", () => {
    const { container } = render(
      <LyricsScroller resolved={wordSynced} activeIndex={0} onSeek={() => {}} wordByWord />,
    );
    const span = container.querySelector("[data-word]") as HTMLElement;
    expect(span).toHaveStyle({
      backgroundOrigin: "border-box",
      paddingBlock: "0.14em",
    });
  });

  it("renders the whole line (no word spans) when word-by-word is off", () => {
    const { container } = render(
      <LyricsScroller resolved={wordSynced} activeIndex={0} onSeek={() => {}} wordByWord={false} />,
    );
    expect(container.querySelectorAll("[data-word]").length).toBe(0);
    expect(screen.getByText("Cause you")).toBeInTheDocument();
  });
});

describe("LyricsScroller (translation / romanization)", () => {
  const withSubs: ResolvedLyrics = {
    mode: "synced",
    source: "netease",
    lines: [
      {
        timeMs: 1000,
        text: "故事的小黄花",
        translation: "the little yellow flower",
        roman: "gushi",
      },
    ],
  };

  it("shows translation and romanization when enabled", () => {
    render(
      <LyricsScroller
        resolved={withSubs}
        activeIndex={0}
        onSeek={() => {}}
        showTranslation
        showRomanization
      />,
    );
    expect(screen.getByText("the little yellow flower")).toBeInTheDocument();
    expect(screen.getByText("gushi")).toBeInTheDocument();
  });

  it("keeps translation and romanization in cascade layout-engine mode", () => {
    render(
      <LyricsScroller
        resolved={withSubs}
        activeIndex={0}
        onSeek={() => {}}
        showTranslation
        showRomanization
        motionMode="cascade"
      />,
    );
    expect(screen.getByText("the little yellow flower")).toBeInTheDocument();
    expect(screen.getByText("gushi")).toBeInTheDocument();
    expect(screen.getByTestId("lyrics-scroll")).toHaveAttribute("data-layout-engine", "amll-style");
  });

  it("hides each sub-line when its toggle is off", () => {
    render(
      <LyricsScroller
        resolved={withSubs}
        activeIndex={0}
        onSeek={() => {}}
        showTranslation={false}
        showRomanization={false}
      />,
    );
    expect(screen.queryByText("the little yellow flower")).toBeNull();
    expect(screen.queryByText("gushi")).toBeNull();
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

describe("SyncedLyricsView (lyrics-only overlay)", () => {
  it("renders nothing when empty lyrics should be hidden", () => {
    const { container } = render(
      <SyncedLyricsView emptyFallback="hidden" track={trackWithoutLyrics} />,
    );

    expect(container).toBeEmptyDOMElement();
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

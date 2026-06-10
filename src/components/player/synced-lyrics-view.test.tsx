import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedLyrics } from "@/lyrics/resolve-lyrics";
import { LyricsScroller } from "./synced-lyrics-view";

vi.mock("react-i18next", () => ({
  initReactI18next: { init: () => undefined, type: "3rdParty" },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "lyrics.source" ? `Lyrics from ${opts?.source}` : key,
  }),
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
    render(<LyricsScroller resolved={synced} positionMs={0} onSeek={() => {}} />);
    expect(screen.getByText("line one")).toBeInTheDocument();
    expect(screen.getByText("line two")).toBeInTheDocument();
    expect(screen.getByText("line three")).toBeInTheDocument();
  });

  it("marks the active line for the current position", () => {
    render(<LyricsScroller resolved={synced} positionMs={1500} onSeek={() => {}} />);
    expect(screen.getByText("line one").getAttribute("aria-current")).toBe("true");
    expect(screen.getByText("line two").getAttribute("aria-current")).toBeNull();
  });

  it("seeks to a line's start time when clicked", () => {
    const onSeek = vi.fn();
    render(<LyricsScroller resolved={synced} positionMs={0} onSeek={onSeek} />);
    fireEvent.click(screen.getByText("line two"));
    expect(onSeek).toHaveBeenCalledWith(2); // 2000ms / 1000
  });

  it("attributes LRCLIB as the source", () => {
    render(<LyricsScroller resolved={synced} positionMs={0} onSeek={() => {}} />);
    expect(screen.getByText("Lyrics from LRCLIB")).toBeInTheDocument();
  });
});

describe("LyricsScroller (plain)", () => {
  it("renders plain text and omits LRCLIB attribution for manual lyrics", () => {
    const plain: ResolvedLyrics = { mode: "plain", source: "manual", text: "hello world" };
    render(<LyricsScroller resolved={plain} positionMs={0} onSeek={() => {}} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
    expect(screen.queryByText(/Lyrics from/)).toBeNull();
  });
});

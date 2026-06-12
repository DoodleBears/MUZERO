import { describe, expect, it } from "vitest";
import { solveLyricLayout } from "./lyric-layout-engine";
import type { LyricRenderLine } from "./lyric-render-line";

const lines: LyricRenderLine[] = [
  { id: "0", index: 0, startMs: 0, endMs: 1000, text: "one" },
  { id: "1", index: 1, startMs: 1000, endMs: 2000, text: "two" },
  { id: "2", index: 2, startMs: 2000, endMs: 3000, text: "three" },
  { id: "3", index: 3, startMs: 3000, endMs: 4000, text: "four" },
  { id: "4", index: 4, startMs: 4000, endMs: 5000, text: "five" },
];

describe("solveLyricLayout", () => {
  it("anchors the active line at the requested viewport position", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 2,
      lineHeights: [40, 50, 60, 70, 80],
      viewportHeight: 500,
      alignPosition: 0.42,
      lineGapPx: 10,
      reducedMotion: false,
    });

    expect(layout.frames[2]).toMatchObject({
      index: 2,
      state: "active",
      y: 180,
      naturalY: 110,
      translateY: 70,
      opacity: 1,
      scale: 1,
      blurPx: 0,
      delaySec: 0,
    });
    expect(layout.anchorY).toBe(210);
  });

  it("positions neighboring lines above and below the active line", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 2,
      lineHeights: [40, 50, 60, 70, 80],
      viewportHeight: 500,
      alignPosition: 0.42,
      lineGapPx: 10,
      reducedMotion: false,
    });

    expect(layout.frames.map((frame) => frame.y)).toEqual([70, 120, 180, 250, 330]);
    expect(layout.frames.map((frame) => frame.translateY)).toEqual([70, 70, 70, 70, 70]);
  });

  it("assigns visual state, blur, scale, and stagger by distance", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 1,
      lineHeights: [40, 40, 40, 40, 40],
      viewportHeight: 400,
      alignPosition: 0.42,
      lineGapPx: 8,
      reducedMotion: false,
    });

    expect(layout.frames.map((frame) => frame.state)).toEqual([
      "passed",
      "active",
      "upcoming",
      "upcoming",
      "distant",
    ]);
    expect(layout.frames[2]).toMatchObject({ opacity: 0.78, scale: 0.96, blurPx: 1.2 });
    expect(layout.frames[3].delaySec).toBeGreaterThan(layout.frames[2].delaySec);
  });

  it("applies caller-provided opacity and inactive scale when supplied", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 1,
      lineHeights: [40, 40, 40, 40, 40],
      viewportHeight: 400,
      alignPosition: 0.42,
      lineGapPx: 8,
      reducedMotion: false,
      visualStyle: {
        activeOpacity: 0.66,
        inactiveOpacity: 0.24,
        inactiveScale: 0.5,
      },
    });

    expect(layout.frames[1]).toMatchObject({ opacity: 0.66, scale: 1 });
    expect(layout.frames[0]).toMatchObject({ opacity: 0.24, scale: 0.5 });
    expect(layout.frames[3]).toMatchObject({ opacity: 0.24, scale: 0.5 });
  });

  it("applies caller-provided cascade anchor, blur, and stagger tuning", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 1,
      lineHeights: [40, 40, 40, 40, 40],
      viewportHeight: 400,
      alignPosition: 0.5,
      lineGapPx: 8,
      reducedMotion: false,
      cascadeTuning: {
        maxBlurPx: 6,
        staggerMs: 80,
        maxDelayMs: 300,
      },
    });

    expect(layout.anchorY).toBe(200);
    expect(layout.frames[1]).toMatchObject({ y: 180, blurPx: 0, delaySec: 0 });
    expect(layout.frames[2]).toMatchObject({ blurPx: 2, delaySec: 0.08 });
    expect(layout.frames[4]).toMatchObject({ blurPx: 6, delaySec: 0.24 });
  });

  it("uses a calm no-blur layout under reduced motion", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: 1,
      lineHeights: [40, 40, 40, 40, 40],
      viewportHeight: 400,
      alignPosition: 0.42,
      lineGapPx: 8,
      reducedMotion: true,
    });

    expect(layout.frames.every((frame) => frame.blurPx === 0)).toBe(true);
    expect(layout.frames.every((frame) => frame.delaySec === 0)).toBe(true);
    expect(layout.frames.map((frame) => frame.scale)).toEqual([1, 1, 1, 1, 1]);
  });

  it("falls back to the first line when active index is unavailable", () => {
    const layout = solveLyricLayout({
      lines,
      activeIndex: -1,
      lineHeights: [40, 40, 40, 40, 40],
      viewportHeight: 400,
      alignPosition: 0.42,
      lineGapPx: 8,
      reducedMotion: false,
    });

    expect(layout.activeIndex).toBe(0);
    expect(layout.frames[0].state).toBe("active");
  });

  it("keeps a long lyric stack bounded and deterministic", () => {
    const longLines = Array.from({ length: 120 }, (_, index) => ({
      id: String(index),
      index,
      startMs: index * 1000,
      endMs: (index + 1) * 1000,
      text: `line ${index}`,
      translation: index % 3 === 0 ? `translated ${index}` : undefined,
      roman: index % 5 === 0 ? `roman ${index}` : undefined,
    }));
    const heights = longLines.map((_, index) => (index % 3 === 0 ? 88 : 48));
    const layout = solveLyricLayout({
      lines: longLines,
      activeIndex: 100,
      lineHeights: heights,
      viewportHeight: 720,
      alignPosition: 0.42,
      lineGapPx: 12,
      reducedMotion: false,
    });

    expect(layout.frames).toHaveLength(120);
    expect(layout.frames.every((frame) => Number.isFinite(frame.y))).toBe(true);
    expect(layout.frames.every((frame) => frame.delaySec <= 0.22)).toBe(true);
    expect(layout.frames[100]).toMatchObject({
      state: "active",
      opacity: 1,
      scale: 1,
      blurPx: 0,
      delaySec: 0,
    });
    expect(layout.frames[0]?.state).toBe("distant");
    expect(layout.frames[119]?.state).toBe("distant");
  });

  it("can return only a requested frame window without changing active anchoring", () => {
    const full = solveLyricLayout({
      lines,
      activeIndex: 4,
      lineHeights: [44, 52, 60, 68, 76],
      viewportHeight: 500,
      alignPosition: 0.42,
      lineGapPx: 10,
      reducedMotion: false,
    });
    const windowed = solveLyricLayout({
      lines,
      activeIndex: 4,
      lineHeights: [44, 52, 60, 68, 76],
      viewportHeight: 500,
      alignPosition: 0.42,
      lineGapPx: 10,
      reducedMotion: false,
      frameWindow: { startIndex: 3, endIndex: 4 },
    });

    expect(windowed.frames.map((frame) => frame.index)).toEqual([3, 4]);
    expect(windowed.totalHeight).toBe(full.totalHeight);
    expect(windowed.frames[1]).toMatchObject({
      index: 4,
      y: full.frames[4].y,
      translateY: full.frames[4].translateY,
    });
  });

  it("snaps the newly active row to the anchor after a large seek jump", () => {
    const heights = [44, 52, 60, 68, 76];
    const layout = solveLyricLayout({
      lines,
      activeIndex: 4,
      lineHeights: heights,
      viewportHeight: 500,
      alignPosition: 0.42,
      lineGapPx: 10,
      reducedMotion: false,
    });

    expect(layout.frames[4]).toMatchObject({
      state: "active",
      y: 172,
      translateY: -92,
      opacity: 1,
      scale: 1,
      blurPx: 0,
      delaySec: 0,
    });
  });
});

import { describe, expect, it } from "vitest";
import { toLyricRenderLines } from "./lyric-render-line";
import type { LyricLine } from "./model";

describe("toLyricRenderLines", () => {
  it("converts line-level lyrics into the engine render contract", () => {
    const lines: LyricLine[] = [
      { timeMs: 1000, text: "first line" },
      { timeMs: 2400, text: "second line", endMs: 3100 },
    ];

    expect(toLyricRenderLines(lines)).toEqual([
      {
        id: "1000:0:first line",
        index: 0,
        startMs: 1000,
        endMs: 2400,
        text: "first line",
      },
      {
        id: "2400:1:second line",
        index: 1,
        startMs: 2400,
        endMs: 3100,
        text: "second line",
      },
    ]);
  });

  it("preserves word timings, translation, and romanization", () => {
    const lines: LyricLine[] = [
      {
        timeMs: 1000,
        endMs: 2200,
        text: "Cause you",
        words: [
          { timeMs: 1000, durMs: 500, text: "Cause " },
          { timeMs: 1500, durMs: 700, text: "you" },
        ],
        translation: "because of you",
        roman: "kooz yoo",
      },
    ];

    expect(toLyricRenderLines(lines)[0]).toMatchObject({
      words: [
        { text: "Cause ", startMs: 1000, endMs: 1500 },
        { text: "you", startMs: 1500, endMs: 2200 },
      ],
      translation: "because of you",
      roman: "kooz yoo",
    });
  });

  it("uses a bounded fallback end time for the final line", () => {
    expect(toLyricRenderLines([{ timeMs: 5000, text: "final" }])[0]).toMatchObject({
      startMs: 5000,
      endMs: 8000,
    });
  });

  it("keeps end times monotonic when source data is too short", () => {
    expect(toLyricRenderLines([{ timeMs: 5000, endMs: 5005, text: "short" }])[0]).toMatchObject({
      startMs: 5000,
      endMs: 5040,
    });
  });
});

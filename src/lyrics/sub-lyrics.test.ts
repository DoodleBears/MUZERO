import { describe, expect, it } from "vitest";
import { attachSubLyrics } from "./sub-lyrics";

const main = [
  { timeMs: 1000, text: "line one" },
  { timeMs: 2000, text: "line two" },
  { timeMs: 3000, text: "line three" },
];

describe("attachSubLyrics", () => {
  it("attaches a translation LRC to the matching lines by timestamp", () => {
    const tl = "[00:01.00]第一行\n[00:02.00]第二行\n[00:03.00]第三行";
    expect(attachSubLyrics(main, tl)).toEqual([
      { timeMs: 1000, text: "line one", translation: "第一行" },
      { timeMs: 2000, text: "line two", translation: "第二行" },
      { timeMs: 3000, text: "line three", translation: "第三行" },
    ]);
  });

  it("attaches romanization on the roman argument", () => {
    const roman = "[00:01.00]daiichi\n[00:02.00]daini";
    const out = attachSubLyrics(main, undefined, roman);
    expect(out[0].roman).toBe("daiichi");
    expect(out[1].roman).toBe("daini");
    expect(out[2].roman).toBeUndefined();
  });

  it("matches the nearest line within tolerance and ignores far ones", () => {
    // "close" is 200ms from main[0] (ok); "far" at 5s is >400ms from every main line.
    const tl = "[00:01.20]close\n[00:05.00]far";
    const out = attachSubLyrics(main, tl);
    expect(out[0].translation).toBe("close");
    expect(out[1].translation).toBeUndefined();
    expect(out[2].translation).toBeUndefined();
  });

  it("returns the input unchanged when there is no translation or roman", () => {
    expect(attachSubLyrics(main)).toBe(main);
    expect(attachSubLyrics(main, "", "")).toBe(main);
  });

  it("preserves word timings while adding sub-lines", () => {
    const withWords = [
      { timeMs: 1000, text: "hi", words: [{ timeMs: 1000, durMs: 500, text: "hi" }] },
    ];
    const out = attachSubLyrics(withWords, "[00:01.00]你好");
    expect(out[0].words).toEqual([{ timeMs: 1000, durMs: 500, text: "hi" }]);
    expect(out[0].translation).toBe("你好");
  });
});

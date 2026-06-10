import { describe, expect, it } from "vitest";
import { parseEnhancedLrc } from "./enhanced-lrc";

describe("parseEnhancedLrc", () => {
  it("parses inline <mm:ss.xx> word stamps into per-word timings", () => {
    const lines = parseEnhancedLrc(
      "[00:10.00]<00:10.00>Cause <00:10.50>you <00:10.80>don't\n[00:12.00]<00:12.00>next",
    );
    expect(lines[0]).toEqual({
      timeMs: 10000,
      endMs: 12000,
      text: "Cause you don't",
      words: [
        { timeMs: 10000, durMs: 500, text: "Cause " },
        { timeMs: 10500, durMs: 300, text: "you " },
        // last word of the line runs until the next line starts
        { timeMs: 10800, durMs: 1200, text: "don't" },
      ],
    });
  });

  it("keeps each word's trailing space so re-joining never drops gaps", () => {
    const [line] = parseEnhancedLrc("[00:00.00]<00:00.00>you <00:00.50>don't");
    expect(line.words?.map((w) => w.text)).toEqual(["you ", "don't"]);
    expect(line.text).toBe("you don't");
  });

  it("gives the final word of the final line a default duration", () => {
    const [line] = parseEnhancedLrc("[00:01.00]<00:01.00>solo");
    expect(line.words).toEqual([{ timeMs: 1000, durMs: 800, text: "solo" }]);
    expect(line.endMs).toBe(1800);
  });

  it("handles CJK words with no inner spaces", () => {
    const [line] = parseEnhancedLrc("[00:01.00]<00:01.00>你<00:01.50>好");
    expect(line.text).toBe("你好");
    expect(line.words).toEqual([
      { timeMs: 1000, durMs: 500, text: "你" },
      { timeMs: 1500, durMs: 800, text: "好" },
    ]);
  });

  it("falls back to a whole-line word when a line has no inline stamps", () => {
    const [line] = parseEnhancedLrc("[00:02.00]plain line");
    expect(line).toEqual({
      timeMs: 2000,
      endMs: 2800,
      text: "plain line",
      words: [{ timeMs: 2000, durMs: 800, text: "plain line" }],
    });
  });

  it("sorts lines ascending and skips lines without a header", () => {
    const lines = parseEnhancedLrc("garbage\n[00:05.00]<00:05.00>b\n[00:01.00]<00:01.00>a");
    expect(lines.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

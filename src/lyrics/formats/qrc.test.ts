import { describe, expect, it } from "vitest";
import { parseQrc } from "./qrc";

describe("parseQrc", () => {
  it("parses QQ qrc lines (text-then-time, absolute start + duration)", () => {
    const lines = parseQrc("[1000,800]Hello (1000,300)world (1300,250)\n[2000,500]bye (2000,500)");
    expect(lines).toEqual([
      {
        timeMs: 1000,
        endMs: 1800,
        text: "Hello world",
        words: [
          { timeMs: 1000, durMs: 300, text: "Hello " },
          { timeMs: 1300, durMs: 250, text: "world " },
        ],
      },
      {
        timeMs: 2000,
        endMs: 2500,
        text: "bye",
        words: [{ timeMs: 2000, durMs: 500, text: "bye " }],
      },
    ]);
  });

  it("handles CJK words with no spaces", () => {
    const [line] = parseQrc("[0,600]情(0,300)花(300,300)");
    expect(line.text).toBe("情花");
    expect(line.words).toEqual([
      { timeMs: 0, durMs: 300, text: "情" },
      { timeMs: 300, durMs: 300, text: "花" },
    ]);
  });

  it("sorts lines ascending and skips headerless lines", () => {
    const lines = parseQrc("noise\n[5000,200]b(5000,200)\n[1000,200]a(1000,200)");
    expect(lines.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

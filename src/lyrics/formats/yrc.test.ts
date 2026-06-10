import { describe, expect, it } from "vitest";
import { parseYrc } from "./yrc";

describe("parseYrc", () => {
  it("parses NetEase yrc lines with absolute word start + explicit duration", () => {
    const lines = parseYrc(
      "[1000,800](1000,300,0)Hello (1300,250,0)world\n[2000,500](2000,500,0)bye",
    );
    expect(lines).toEqual([
      {
        timeMs: 1000,
        endMs: 1800,
        text: "Hello world",
        words: [
          { timeMs: 1000, durMs: 300, text: "Hello " },
          { timeMs: 1300, durMs: 250, text: "world" },
        ],
      },
      {
        timeMs: 2000,
        endMs: 2500,
        text: "bye",
        words: [{ timeMs: 2000, durMs: 500, text: "bye" }],
      },
    ]);
  });

  it("keeps word trailing spaces (no 'youdon't' joins)", () => {
    const [line] = parseYrc("[0,900](0,300,0)you (300,300,0)don't (600,300,0)run");
    expect(line.text).toBe("you don't run");
  });

  it("skips credit-JSON metadata lines (with or without a header)", () => {
    const raw = [
      '{"c":[{"tx":"作词: "},{"tx":"x"}]}',
      '[0,0]{"c":[{"tx":"作曲: "},{"tx":"y"}]}',
      "[1000,400](1000,400,0)real",
    ].join("\n");
    expect(parseYrc(raw).map((l) => l.text)).toEqual(["real"]);
  });

  it("sorts lines ascending and skips headerless lines", () => {
    const lines = parseYrc("noise\n[5000,200](5000,200,0)b\n[1000,200](1000,200,0)a");
    expect(lines.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

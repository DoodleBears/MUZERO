import { describe, expect, it } from "vitest";
import { parseLrc } from "./parse-lrc";

describe("parseLrc", () => {
  it("parses a single timestamped line (centiseconds)", () => {
    expect(parseLrc("[00:12.34]hello")).toEqual([{ timeMs: 12340, text: "hello" }]);
  });

  it("converts minutes/seconds and trims the text", () => {
    expect(parseLrc("[01:05.00]  world  ")).toEqual([{ timeMs: 65000, text: "world" }]);
  });

  it("handles 1, 2 and 3 fractional digits", () => {
    expect(parseLrc("[00:01.5]a")[0].timeMs).toBe(1500);
    expect(parseLrc("[00:01.50]a")[0].timeMs).toBe(1500);
    expect(parseLrc("[00:01.345]a")[0].timeMs).toBe(1345);
  });

  it("expands a line with multiple timestamps into multiple lines", () => {
    expect(parseLrc("[00:01.00][00:02.00]hey")).toEqual([
      { timeMs: 1000, text: "hey" },
      { timeMs: 2000, text: "hey" },
    ]);
  });

  it("keeps interlude lines that have a timestamp but no text", () => {
    expect(parseLrc("[00:30.00]")).toEqual([{ timeMs: 30000, text: "" }]);
  });

  it("skips metadata tags (ar/ti/al/by/length)", () => {
    const lrc = "[ar:Artist]\n[ti:Title]\n[al:Album]\n[00:10.00]line";
    expect(parseLrc(lrc)).toEqual([{ timeMs: 10000, text: "line" }]);
  });

  it("applies a positive offset tag by adding to every timestamp", () => {
    expect(parseLrc("[offset:+500]\n[00:10.00]x")).toEqual([{ timeMs: 10500, text: "x" }]);
  });

  it("applies a negative offset and never goes below zero", () => {
    expect(parseLrc("[offset:-2000]\n[00:01.00]x")).toEqual([{ timeMs: 0, text: "x" }]);
  });

  it("drops malformed and non-timestamped lines", () => {
    const lrc = "garbage\n[xx:yy]bad\n[00:03.00]good";
    expect(parseLrc(lrc)).toEqual([{ timeMs: 3000, text: "good" }]);
  });

  it("sorts lines ascending by time", () => {
    const lrc = "[00:05.00]b\n[00:01.00]a\n[00:03.00]ab";
    expect(parseLrc(lrc).map((l) => l.text)).toEqual(["a", "ab", "b"]);
  });

  it("returns an empty array for empty or whitespace input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("   \n  ")).toEqual([]);
  });
});

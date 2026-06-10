import { describe, expect, it } from "vitest";
import { detectLyricsFormat, parseLyrics } from "./parse";

describe("detectLyricsFormat", () => {
  it("detects line-level LRC", () => {
    expect(detectLyricsFormat("[00:12.34]hello\n[00:15.00]world")).toBe("lrc");
  });

  it("detects Enhanced LRC (inline <mm:ss.xx> word stamps)", () => {
    expect(detectLyricsFormat("[00:10.00]<00:10.00>Cause <00:10.50>you")).toBe("elrc");
  });

  it("detects NetEase YRC (3-int word stamps)", () => {
    expect(detectLyricsFormat("[1000,500](1000,200,0)Cause (1200,300,0)you")).toBe("yrc");
  });

  it("detects QQ QRC (text-then-2-int word stamps)", () => {
    expect(detectLyricsFormat("[1000,500]Cause(1000,200)you(1200,300)")).toBe("qrc");
  });

  it("prefers yrc over qrc when 3-int word stamps are present", () => {
    // yrc lines also carry the [start,dur] header that qrc uses — the 3-int
    // word stamp `(s,d,0)` is the discriminator.
    expect(detectLyricsFormat("[0,1000](0,500,0)word")).toBe("yrc");
  });

  it("detects TTML", () => {
    const ttml =
      '<?xml version="1.0"?>\n<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p>hi</p></div></body></tt>';
    expect(detectLyricsFormat(ttml)).toBe("ttml");
  });

  it("treats untimed text as plain", () => {
    expect(detectLyricsFormat("just a line\nanother line")).toBe("plain");
  });

  it("treats empty/whitespace as plain", () => {
    expect(detectLyricsFormat("")).toBe("plain");
    expect(detectLyricsFormat("   \n ")).toBe("plain");
  });
});

describe("parseLyrics", () => {
  it("parses line-level LRC into the unified model", () => {
    expect(parseLyrics("[00:12.34]hello")).toEqual([{ timeMs: 12340, text: "hello" }]);
  });

  it("honors an explicit format over auto-detection", () => {
    expect(parseLyrics("[00:12.34]hi", "lrc")).toEqual([{ timeMs: 12340, text: "hi" }]);
  });

  it("strips Enhanced-LRC word stamps until the dedicated parser lands (Phase 1)", () => {
    // Phase 1 routes elrc through the line parser, which strips <…> stamps. Phase 2
    // replaces this with per-word parsing.
    expect(parseLyrics("[00:10.00]<00:10.00>Cause <00:10.50>you")).toEqual([
      { timeMs: 10000, text: "Cause you" },
    ]);
  });

  it("returns an empty array for plain or empty text", () => {
    expect(parseLyrics("just words")).toEqual([]);
    expect(parseLyrics("")).toEqual([]);
  });
});

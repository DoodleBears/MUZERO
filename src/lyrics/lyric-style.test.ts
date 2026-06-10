import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import { DEFAULT_LYRIC_STYLE, resolveLyricStyle } from "./lyric-style";

const base = {} as AppSettings;

describe("resolveLyricStyle", () => {
  it("falls back to defaults for an empty settings object", () => {
    expect(resolveLyricStyle(base, null)).toEqual(DEFAULT_LYRIC_STYLE);
  });

  it("converts 0–100 opacity to 0–1 and keeps px sizes", () => {
    const s = {
      lyricsActiveFontSize: 30,
      lyricsInactiveFontSize: 18,
      lyricsActiveOpacity: 90,
      lyricsInactiveOpacity: 25,
    } as AppSettings;
    expect(resolveLyricStyle(s, null)).toMatchObject({
      activeFontSize: 30,
      inactiveFontSize: 18,
      activeOpacity: 0.9,
      inactiveOpacity: 0.25,
    });
  });

  it("clamps font size to 12–64px and opacity to 0–1", () => {
    const s = {
      lyricsActiveFontSize: 999,
      lyricsInactiveFontSize: 2,
      lyricsActiveOpacity: 500,
      lyricsInactiveOpacity: -50,
    } as AppSettings;
    const r = resolveLyricStyle(s, null);
    expect(r.activeFontSize).toBe(64);
    expect(r.inactiveFontSize).toBe(12);
    expect(r.activeOpacity).toBe(1);
    expect(r.inactiveOpacity).toBe(0);
  });

  it("default mode leaves color undefined (inherit foreground)", () => {
    expect(
      resolveLyricStyle({ lyricsColorMode: "default" } as AppSettings, "rgb(1,2,3)").color,
    ).toBeUndefined();
  });

  it("cover mode uses the cover color (or undefined when absent)", () => {
    expect(resolveLyricStyle({ lyricsColorMode: "cover" } as AppSettings, "rgb(1,2,3)").color).toBe(
      "rgb(1,2,3)",
    );
    expect(
      resolveLyricStyle({ lyricsColorMode: "cover" } as AppSettings, null).color,
    ).toBeUndefined();
  });

  it("custom mode uses the custom hex", () => {
    const s = { lyricsColorMode: "custom", lyricsCustomColor: "#ff8800" } as AppSettings;
    expect(resolveLyricStyle(s, "rgb(1,2,3)").color).toBe("#ff8800");
  });
});

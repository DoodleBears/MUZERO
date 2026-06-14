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

  it("cover mode uses the cover color preset (or undefined when absent)", () => {
    expect(
      resolveLyricStyle(
        { lyricsColorMode: "cover", theme: "dark" } as AppSettings,
        "rgb(100,100,100)",
      ).color,
    ).toBe("rgb(150, 150, 150)");
    expect(
      resolveLyricStyle({ lyricsColorMode: "cover" } as AppSettings, null).color,
    ).toBeUndefined();
  });

  it("uses a dimmer cover color brightness preset in light mode", () => {
    expect(
      resolveLyricStyle(
        { lyricsColorMode: "cover", theme: "light" } as AppSettings,
        "rgb(100, 100, 100)",
      ).color,
    ).toBe("rgb(50, 50, 50)");
  });

  it("keeps cover color unchanged when cover color adjustments are neutral", () => {
    const s = {
      lyricsColorMode: "cover",
      lyricsCoverColorSaturation: 100,
      lyricsCoverColorBrightness: 100,
      lyricsCoverColorContrast: 100,
    } as AppSettings;

    expect(resolveLyricStyle(s, "rgba(10, 20, 30, 1)").color).toBe("rgba(10, 20, 30, 1)");
  });

  it("adjusts cover-derived lyric color saturation, brightness, and contrast", () => {
    expect(
      resolveLyricStyle(
        {
          lyricsColorMode: "cover",
          lyricsCoverColorSaturation: 0,
          lyricsCoverColorBrightness: 100,
        } as AppSettings,
        "rgb(120, 60, 30)",
      ).color,
    ).toBe("rgb(75, 75, 75)");
    expect(
      resolveLyricStyle(
        { lyricsColorMode: "cover", lyricsCoverColorBrightness: 150 } as AppSettings,
        "rgb(100, 100, 100)",
      ).color,
    ).toBe("rgb(150, 150, 150)");
    expect(
      resolveLyricStyle(
        { lyricsColorMode: "cover", lyricsCoverColorContrast: 0 } as AppSettings,
        "rgb(100, 150, 200)",
      ).color,
    ).toBe("rgb(128, 128, 128)");
  });

  it("falls back to the original cover color when adjustments cannot parse the css", () => {
    const s = {
      lyricsColorMode: "cover",
      lyricsCoverColorBrightness: 150,
    } as AppSettings;

    expect(resolveLyricStyle(s, "var(--cover-color)").color).toBe("var(--cover-color)");
  });

  it("custom mode uses the custom hex", () => {
    const s = { lyricsColorMode: "custom", lyricsCustomColor: "#ff8800" } as AppSettings;
    expect(resolveLyricStyle(s, "rgb(1,2,3)").color).toBe("#ff8800");
  });

  describe("textStroke (outline)", () => {
    it("is empty when width is 0 / unset (no outline)", () => {
      expect(resolveLyricStyle(base, null).textStroke).toBe("");
      expect(resolveLyricStyle({ lyricsStrokeWidth: 0 } as AppSettings, null).textStroke).toBe("");
    });

    it("is empty when fully transparent (opacity 0)", () => {
      const s = { lyricsStrokeWidth: 3, lyricsStrokeOpacity: 0 } as AppSettings;
      expect(resolveLyricStyle(s, null).textStroke).toBe("");
    });

    it("builds width + color, defaulting to opaque black (color passes through)", () => {
      const s = { lyricsStrokeWidth: 3 } as AppSettings;
      expect(resolveLyricStyle(s, null).textStroke).toBe("3px #000000");
    });

    it("applies the custom hex color and opacity via color-mix", () => {
      const s = {
        lyricsStrokeWidth: 2,
        lyricsStrokeColor: "#ff8800",
        lyricsStrokeOpacity: 50,
      } as AppSettings;
      expect(resolveLyricStyle(s, null).textStroke).toBe(
        "2px color-mix(in srgb, #ff8800 50%, transparent)",
      );
    });

    it("clamps width to 0–12px", () => {
      expect(resolveLyricStyle({ lyricsStrokeWidth: 999 } as AppSettings, null).textStroke).toBe(
        "12px #000000",
      );
    });

    it("cover mode uses the visualizer cover color (any CSS format)", () => {
      const opaque = {
        lyricsStrokeWidth: 2,
        lyricsStrokeColorMode: "cover",
      } as AppSettings;
      expect(resolveLyricStyle(opaque, "rgba(1, 2, 3, 1)").textStroke).toBe("2px rgba(1, 2, 3, 1)");

      const dimmed = { ...opaque, lyricsStrokeOpacity: 40 } as AppSettings;
      expect(resolveLyricStyle(dimmed, "rgba(1, 2, 3, 1)").textStroke).toBe(
        "2px color-mix(in srgb, rgba(1, 2, 3, 1) 40%, transparent)",
      );
    });

    it("cover mode falls back to the custom hex when no cover color is loaded", () => {
      const s = {
        lyricsStrokeWidth: 2,
        lyricsStrokeColorMode: "cover",
        lyricsStrokeColor: "#112233",
      } as AppSettings;
      expect(resolveLyricStyle(s, null).textStroke).toBe("2px #112233");
    });
  });
});

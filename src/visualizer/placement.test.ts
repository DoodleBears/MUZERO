import { describe, expect, it } from "vitest";
import type { AppSettings } from "@/db/types";
import { nextVisualizerPlacementPatch, resolveVisualizerPlacement } from "./placement";

describe("visualizer placement", () => {
  it("cycles off -> background -> idle -> lyrics -> off", () => {
    let settings = {
      visualizerStyle: "bars",
      visualizerAsBackground: false,
      visualizerIdleOnly: false,
      visualizerLyricsOnlyIdle: false,
    } satisfies Partial<AppSettings> as AppSettings;

    expect(resolveVisualizerPlacement(settings)).toBe("off");

    settings = { ...settings, ...nextVisualizerPlacementPatch(settings) };
    expect(resolveVisualizerPlacement(settings)).toBe("background");
    expect(settings.visualizerLyricsOnlyIdle).toBe(false);

    settings = { ...settings, ...nextVisualizerPlacementPatch(settings) };
    expect(resolveVisualizerPlacement(settings)).toBe("idle");
    expect(settings.visualizerLyricsOnlyIdle).toBe(false);

    settings = { ...settings, ...nextVisualizerPlacementPatch(settings) };
    expect(resolveVisualizerPlacement(settings)).toBe("lyrics");
    expect(settings.visualizerIdleOnly).toBe(true);
    expect(settings.visualizerLyricsOnlyIdle).toBe(true);

    settings = { ...settings, ...nextVisualizerPlacementPatch(settings) };
    expect(resolveVisualizerPlacement(settings)).toBe("off");
    expect(settings.visualizerAsBackground).toBe(false);
    expect(settings.visualizerIdleOnly).toBe(false);
    expect(settings.visualizerLyricsOnlyIdle).toBe(false);
  });

  it("treats the lyrics-only flag as idle-only plus lyric overlay", () => {
    expect(
      resolveVisualizerPlacement({
        visualizerStyle: "bars",
        visualizerAsBackground: true,
        visualizerIdleOnly: true,
        visualizerLyricsOnlyIdle: true,
      } satisfies Partial<AppSettings> as AppSettings),
    ).toBe("lyrics");
  });

  it("keeps the placement off when the chosen visualizer style is off", () => {
    expect(
      resolveVisualizerPlacement({
        visualizerStyle: "off",
        visualizerAsBackground: true,
        visualizerIdleOnly: true,
        visualizerLyricsOnlyIdle: true,
      } satisfies Partial<AppSettings> as AppSettings),
    ).toBe("off");
  });
});

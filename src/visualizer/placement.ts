import type { AppSettings } from "@/db/types";
import { resolveVisualizerStyle } from "./registry";

/** Where the visualizer renders: off → background → idle-only → lyrics-only idle. */
export type VisualizerPlacement = "off" | "background" | "idle" | "lyrics";

const PLACEMENTS: VisualizerPlacement[] = ["off", "background", "idle", "lyrics"];

export function resolveVisualizerPlacement(settings: AppSettings): VisualizerPlacement {
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  if (style === "off" || !(settings.visualizerAsBackground ?? false)) return "off";
  if (!(settings.visualizerIdleOnly ?? false)) return "background";
  return (settings.visualizerLyricsOnlyIdle ?? false) ? "lyrics" : "idle";
}

/** Settings patch that advances the placement one step (off→background→idle→lyrics→off). */
export function nextVisualizerPlacementPatch(settings: AppSettings): Partial<AppSettings> {
  const idx = PLACEMENTS.indexOf(resolveVisualizerPlacement(settings));
  const next = PLACEMENTS[(idx + 1) % PLACEMENTS.length] ?? "off";
  return visualizerPlacementPatch(settings, next);
}

export function visualizerPlacementPatch(
  settings: AppSettings,
  placement: VisualizerPlacement,
): Partial<AppSettings> {
  // Turning OFF only clears `visualizerAsBackground` — we KEEP the style (not
  // set "off") so the spectrum keeps drawing through its fade-out exit instead of
  // blanking instantly, and the chosen style is remembered for re-enabling.
  if (placement === "off") {
    return {
      visualizerAsBackground: false,
      visualizerIdleOnly: false,
      visualizerLyricsOnlyIdle: false,
    };
  }
  const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
  const enabledStyle = currentStyle === "off" ? "bars" : currentStyle;
  return {
    visualizerStyle: enabledStyle,
    visualizerAsBackground: true,
    visualizerIdleOnly: placement === "idle" || placement === "lyrics",
    visualizerLyricsOnlyIdle: placement === "lyrics",
  };
}

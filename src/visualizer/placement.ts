import type { AppSettings } from "@/db/types";
import { resolveVisualizerStyle } from "./registry";

/** Where the visualizer renders: off → Now-Playing background → idle-only. */
export type VisualizerPlacement = "off" | "background" | "idle";

const PLACEMENTS: VisualizerPlacement[] = ["off", "background", "idle"];

export function resolveVisualizerPlacement(settings: AppSettings): VisualizerPlacement {
  const style = resolveVisualizerStyle(settings.visualizerStyle);
  if (style === "off" || !(settings.visualizerAsBackground ?? false)) return "off";
  return (settings.visualizerIdleOnly ?? false) ? "idle" : "background";
}

/** Settings patch that advances the placement one step (off→background→idle→off). */
export function nextVisualizerPlacementPatch(settings: AppSettings): Partial<AppSettings> {
  const idx = PLACEMENTS.indexOf(resolveVisualizerPlacement(settings));
  const next = PLACEMENTS[(idx + 1) % PLACEMENTS.length] ?? "off";
  // Turning OFF only clears `visualizerAsBackground` — we KEEP the style (not
  // set "off") so the spectrum keeps drawing through its fade-out exit instead of
  // blanking instantly, and the chosen style is remembered for re-enabling.
  if (next === "off") {
    return { visualizerAsBackground: false, visualizerIdleOnly: false };
  }
  const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
  const enabledStyle = currentStyle === "off" ? "bars" : currentStyle;
  return {
    visualizerStyle: enabledStyle,
    visualizerAsBackground: true,
    visualizerIdleOnly: next === "idle",
  };
}

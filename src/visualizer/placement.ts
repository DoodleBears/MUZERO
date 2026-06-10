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
  const currentStyle = resolveVisualizerStyle(settings.visualizerStyle);
  const enabledStyle = currentStyle === "off" ? "bars" : currentStyle;
  return {
    visualizerStyle: next === "off" ? "off" : enabledStyle,
    visualizerAsBackground: next !== "off",
    visualizerIdleOnly: next === "idle",
  };
}

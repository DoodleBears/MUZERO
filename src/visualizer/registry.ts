import { createAuraVisualizer } from "./spectrum/aura";
import type { Visualizer, VisualizerBackend, VisualizerKind, VisualizerStyleId } from "./types";

/**
 * Visualizer registry — mirrors the music-gen provider registry
 * (src/musicgen/registry.ts): one resolution point, an id list, and per-style
 * metadata, so the UI and host never branch on `if (style === ...)`. New styles
 * append a META entry + a factory case; nothing else changes.
 */
/** i18n keys for style display names — extend per phase as styles + en keys land. */
export type VisualizerLabelKey = "visualizer.styleOff" | "visualizer.styleAura";

export interface VisualizerMeta {
  id: VisualizerStyleId;
  kind: VisualizerKind;
  backend: VisualizerBackend;
  /** i18n key for the style's display name (en is the type source). */
  labelKey: VisualizerLabelKey;
  /** AnalyserNode config the host applies while this style is active. */
  fftSize: number;
  smoothing: number;
}

/**
 * Registered (implemented) styles, in display order. Grows per phase. The
 * AppSettings `VisualizerStyleId` union may list ids not yet here (forward
 * compat); `resolveVisualizerStyle` falls those back to "aura".
 */
export const VISUALIZER_META: VisualizerMeta[] = [
  {
    id: "off",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleOff",
    fftSize: 256,
    smoothing: 0.8,
  },
  {
    id: "aura",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleAura",
    fftSize: 256,
    smoothing: 0.8,
  },
];

export const VISUALIZER_STYLE_IDS: VisualizerStyleId[] = VISUALIZER_META.map((m) => m.id);

const META_BY_ID = new Map(VISUALIZER_META.map((m) => [m.id, m]));

/** Is this a *registered* (renderable) style? Unimplemented union ids return false. */
export function isRegisteredVisualizerStyle(value: unknown): value is VisualizerStyleId {
  return typeof value === "string" && META_BY_ID.has(value as VisualizerStyleId);
}

/** Resolve a stored style value to a renderable id, falling back to "aura". */
export function resolveVisualizerStyle(style: string | undefined): VisualizerStyleId {
  return isRegisteredVisualizerStyle(style) ? style : "aura";
}

/** Metadata for a registered style (falls back to aura's). */
export function getVisualizerMeta(id: VisualizerStyleId): VisualizerMeta {
  return META_BY_ID.get(id) ?? (META_BY_ID.get("aura") as VisualizerMeta);
}

/**
 * Build the canvas-2D renderer for a style. Returns null for "off" (no
 * visualizer). Scene/milkdrop kinds are handled by the host as lazy React
 * components (Phase 3/4), not here.
 */
export function createVisualizer(id: VisualizerStyleId): Visualizer | null {
  switch (id) {
    case "off":
      return null;
    case "aura":
      return createAuraVisualizer();
    default:
      // Not yet implemented — fall back to aura so a stored future id still renders.
      return createAuraVisualizer();
  }
}

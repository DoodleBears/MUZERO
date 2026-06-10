import { createAuraVisualizer } from "./spectrum/aura";
import { createBarsVisualizer } from "./spectrum/bars";
import { createLedReflexVisualizer } from "./spectrum/led-reflex";
import { createRadialVisualizer } from "./spectrum/radial";
import { createWaveformVisualizer } from "./spectrum/waveform";
import type { Visualizer, VisualizerBackend, VisualizerKind, VisualizerStyleId } from "./types";

/**
 * Visualizer registry — mirrors the music-gen provider registry
 * (src/musicgen/registry.ts): one resolution point, an id list, and per-style
 * metadata, so the UI and host never branch on `if (style === ...)`. New styles
 * append a META entry + a factory case; nothing else changes.
 */
/** i18n keys for style display names — extend per phase as styles + en keys land. */
export type VisualizerLabelKey =
  | "visualizer.styleOff"
  | "visualizer.styleAura"
  | "visualizer.styleBars"
  | "visualizer.styleRadial"
  | "visualizer.styleLed"
  | "visualizer.styleWaveform"
  | "visualizer.styleSceneLiquid"
  | "visualizer.styleSceneAurora"
  | "visualizer.styleSceneFlow";

export interface VisualizerMeta {
  id: VisualizerStyleId;
  kind: VisualizerKind;
  backend: VisualizerBackend;
  /** i18n key for the style's display name (en is the type source). */
  labelKey: VisualizerLabelKey;
  /** AnalyserNode config the host applies while this style is active. */
  fftSize: number;
  smoothing: number;
  /** dB window for getByteFrequencyData (tightens dynamic range). Host defaults -100/-30. */
  minDecibels?: number;
  maxDecibels?: number;
  /** Hidden from the visualizer style picker. Still renderable via an explicit
   *  `styleId` — `scene-flow` is consumed by the independent flow background layer,
   *  NOT chosen as a spectrum style (the two compose, they're not mutually exclusive). */
  hidden?: boolean;
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
  {
    id: "bars",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleBars",
    fftSize: 1024,
    smoothing: 0.82,
    minDecibels: -85,
    maxDecibels: -22,
  },
  {
    id: "radial",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleRadial",
    fftSize: 1024,
    smoothing: 0.82,
    minDecibels: -85,
    maxDecibels: -22,
  },
  {
    id: "led-reflex",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleLed",
    fftSize: 1024,
    smoothing: 0.82,
    minDecibels: -85,
    maxDecibels: -22,
  },
  {
    id: "waveform",
    kind: "spectrum",
    backend: "canvas2d",
    labelKey: "visualizer.styleWaveform",
    fftSize: 1024,
    smoothing: 0.8,
    minDecibels: -90,
    maxDecibels: -10,
  },
  {
    id: "scene-liquid",
    kind: "scene",
    backend: "webgl",
    labelKey: "visualizer.styleSceneLiquid",
    fftSize: 1024,
    smoothing: 0.85,
  },
  {
    id: "scene-aurora",
    kind: "scene",
    backend: "webgl",
    labelKey: "visualizer.styleSceneAurora",
    fftSize: 1024,
    smoothing: 0.85,
  },
  {
    id: "scene-flow",
    kind: "scene",
    backend: "webgl",
    labelKey: "visualizer.styleSceneFlow",
    fftSize: 1024,
    smoothing: 0.88,
    // Flow is an independent background layer, not a spectrum choice → not listed.
    hidden: true,
  },
];

/** Styles offered in the visualizer style picker (excludes layer-only styles). */
export const VISUALIZER_PICKER_META: VisualizerMeta[] = VISUALIZER_META.filter((m) => !m.hidden);

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
    case "bars":
      return createBarsVisualizer();
    case "radial":
      return createRadialVisualizer();
    case "led-reflex":
      return createLedReflexVisualizer();
    case "waveform":
      return createWaveformVisualizer();
    case "scene-liquid":
    case "scene-aurora":
    case "scene-flow":
      // GPU scenes are React components (rendered by SceneHost), not canvas-2D
      // renderers — they have no Visualizer instance.
      return null;
    default:
      // Not yet implemented (milkdrop) — fall back to aura so a stored future id
      // still renders something.
      return createAuraVisualizer();
  }
}

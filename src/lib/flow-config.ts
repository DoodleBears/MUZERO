import type { AppSettings, FlowBlendMode, FlowColorSource, FlowEffectId } from "@/db/types";
import type { Rgb } from "@/lib/visualizer-color";

/**
 * Flow background color resolution + presets. Pure (no DOM / Dexie) so the
 * fallback rule and settings mapping are exhaustively unit-tested. The flow
 * shader (FLOW_FRAG) and the Settings panel both consume these.
 */

/** Default custom flow colors — used for source="custom" and as the cover fallback. */
export const FLOW_DEFAULT_COLORS = ["#7c5cff", "#22d3ee", "#f472b6", "#fbbf24"];

export interface FlowPreset {
  id: string;
  labelKey: string;
  colors: string[];
}

/** One-tap color sets for the flow settings panel. */
export const FLOW_PRESETS: FlowPreset[] = [
  { id: "aurora", labelKey: "flow.presetAurora", colors: ["#22d3ee", "#34d399", "#a78bfa"] },
  { id: "sunset", labelKey: "flow.presetSunset", colors: ["#fb7185", "#f59e0b", "#7c3aed"] },
  { id: "ocean", labelKey: "flow.presetOcean", colors: ["#0ea5e9", "#2563eb", "#14b8a6"] },
  { id: "synthwave", labelKey: "flow.presetSynthwave", colors: ["#7c5cff", "#ff2e97", "#22d3ee"] },
];

export interface FlowEffectMeta {
  id: FlowEffectId;
  labelKey: string;
}

/**
 * Flow effects — the full color4bg style family, each its own self-authored
 * shader (`flow-shaders.ts` `FLOW_FRAGS`). Display order: calm/flowing first,
 * then waves/gradients, then geometric. Selecting one swaps the flow shader.
 */
export const FLOW_EFFECTS: FlowEffectMeta[] = [
  { id: "ambient-light", labelKey: "flow.effectAmbientLight" },
  { id: "aesthetic-fluid", labelKey: "flow.effectAestheticFluid" },
  { id: "big-blob", labelKey: "flow.effectBigBlob" },
  { id: "blur-dot", labelKey: "flow.effectBlurDot" },
  { id: "blur-gradient", labelKey: "flow.effectBlurGradient" },
  { id: "wavy-waves", labelKey: "flow.effectWavyWaves" },
  { id: "chaos-waves", labelKey: "flow.effectChaosWaves" },
  { id: "swirling-curves", labelKey: "flow.effectSwirlingCurves" },
  { id: "curve-gradient", labelKey: "flow.effectCurveGradient" },
  { id: "step-gradient", labelKey: "flow.effectStepGradient" },
  { id: "grid-array", labelKey: "flow.effectGridArray" },
  { id: "triangles-mosaic", labelKey: "flow.effectTrianglesMosaic" },
  { id: "random-cubes", labelKey: "flow.effectRandomCubes" },
  { id: "abstract-shape", labelKey: "flow.effectAbstractShape" },
];

/** Default flow effect. */
export const DEFAULT_FLOW_EFFECT: FlowEffectId = "chaos-waves";

/** Default flow tuning (0–100 sliders + effect + blend). Centralized so the
 *  resolver, the Settings panel, and the background layer agree. */
export const FLOW_DEFAULTS = {
  effect: DEFAULT_FLOW_EFFECT,
  motion: 100,
  scale: 50,
  reactivity: 75,
  opacity: 50,
  dim: 0,
  blendMode: "overlay" as FlowBlendMode,
} as const;

/** Default blend for the background visualizer (spectrum) layer. Screen keeps
 *  the dark canvas transparent so the bands read as glow over the flow/cover. */
export const VISUALIZER_BLEND_DEFAULT: FlowBlendMode = "screen";

/** Blend modes offered for compositing the flow over the background (CSS
 *  mix-blend-mode values). The compositor does add/multiply natively — no Pixi. */
export const FLOW_BLEND_MODES: { id: FlowBlendMode; labelKey: string }[] = [
  { id: "normal", labelKey: "flow.blendNormal" },
  { id: "screen", labelKey: "flow.blendScreen" },
  { id: "plus-lighter", labelKey: "flow.blendAdd" },
  { id: "multiply", labelKey: "flow.blendMultiply" },
  { id: "overlay", labelKey: "flow.blendOverlay" },
  { id: "soft-light", labelKey: "flow.blendSoftLight" },
];

/** Smallest / largest number of flow colors a user can keep. */
export const FLOW_MIN_COLORS = 2;
export const FLOW_MAX_COLORS = 5;

export interface FlowConfig {
  source: FlowColorSource;
  customColors: Rgb[];
  /** Which flow shader to render (selects `FLOW_FRAGS[effect]`). */
  effect: FlowEffectId;
  /** 0..1 uniforms. */
  speed: number;
  scale: number;
  reactivity: number;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalize a hex color to "#rrggbb" (lowercase), expanding shorthand. Null if invalid. */
export function normalizeHexColor(raw: string): string | null {
  const m = raw.trim().match(HEX_RE);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${hex}`;
}

export function hexToRgb(raw: string): Rgb | null {
  const norm = normalizeHexColor(raw);
  if (!norm) return null;
  return {
    r: Number.parseInt(norm.slice(1, 3), 16),
    g: Number.parseInt(norm.slice(3, 5), 16),
    b: Number.parseInt(norm.slice(5, 7), 16),
  };
}

/** Parse a hex list to RGB, dropping invalid entries. */
export function normalizeFlowColors(raw: string[]): Rgb[] {
  return raw.map(hexToRgb).filter((c): c is Rgb => c !== null);
}

/**
 * Decide which colors drive the flow shader — the single fallback rule
 * (requirement 2): the cover source uses the live palette but drops to the custom
 * set whenever the cover yields fewer than two colors; the custom source always wins.
 */
export function resolveFlowColors(source: FlowColorSource, palette: Rgb[], custom: Rgb[]): Rgb[] {
  if (source === "cover" && palette.length >= FLOW_MIN_COLORS) return palette;
  return custom;
}

type FlowSettings = Pick<
  AppSettings,
  | "flowColorSource"
  | "flowCustomColors"
  | "flowEffect"
  | "flowMotion"
  | "flowScale"
  | "flowAudioReactivity"
>;

/** Resolve persisted flow settings into shader-ready values (defaults applied). */
export function resolveFlowConfig(settings: FlowSettings): FlowConfig {
  const effect: FlowEffectId =
    settings.flowEffect && FLOW_EFFECTS.some((e) => e.id === settings.flowEffect)
      ? settings.flowEffect
      : DEFAULT_FLOW_EFFECT;
  return {
    source: settings.flowColorSource ?? "cover",
    customColors: pickCustomColors(settings.flowCustomColors),
    effect,
    speed: clamp01((settings.flowMotion ?? FLOW_DEFAULTS.motion) / 100),
    scale: clamp01((settings.flowScale ?? FLOW_DEFAULTS.scale) / 100),
    reactivity: clamp01((settings.flowAudioReactivity ?? FLOW_DEFAULTS.reactivity) / 100),
  };
}

function pickCustomColors(raw: string[] | undefined): Rgb[] {
  const parsed = normalizeFlowColors(raw ?? FLOW_DEFAULT_COLORS);
  return parsed.length >= FLOW_MIN_COLORS ? parsed : normalizeFlowColors(FLOW_DEFAULT_COLORS);
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

import type { Rgb } from "@/lib/visualizer-color";
import type { VisualizerRenderOptions } from "@/lib/visualizer-effect-settings";

/**
 * All visualizer style ids (forward-compatible union — some are implemented in
 * later phases; unimplemented stored values fall back to "bars" via the registry).
 * `off` = no visualizer. `scene-*` = GPU shader scenes (Phase 3). `milkdrop` =
 * butterchurn (Phase 4, deferred v2). Keep ids stable (codename layer).
 */
export type VisualizerStyleId =
  | "off"
  | "aura"
  | "bars"
  | "radial"
  | "led-reflex"
  | "waveform"
  | "scene-liquid"
  | "scene-aurora"
  | "scene-flow"
  | "milkdrop";

export type VisualizerKind = "spectrum" | "scene" | "milkdrop";
export type VisualizerBackend = "canvas2d" | "webgl" | "webgl2";
export type VisualizerPlacement = "surface" | "background";

/** What the host hands a canvas-2D renderer. The host owns the canvas, the rAF
 *  loop, dpr scaling, clearing, and the shared analyser's configuration. */
export interface VisualizerContext {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** The shared analyser (host has set fftSize/smoothing for this style). Null pre-play. */
  getAnalyser: () => AnalyserNode | null;
  /** The live `--primary` accent as RGB (re-read so it tracks theme/user changes). */
  primary: () => Rgb;
  /** True while a scoped/dynamic color source is driving the visualizer. */
  smoothPrimary?: () => boolean;
  /** Whether audio is currently playing (idle visuals when false). */
  active: () => boolean;
  /** OS reduced-motion preference (renderers may calm their motion). */
  reducedMotion: () => boolean;
  /** Where this visualizer is rendered. Background renderers may fill more space. */
  placement?: VisualizerPlacement;
  /** User-tunable visual parameters resolved from Settings. */
  options: VisualizerRenderOptions;
}

/** A canvas-2D spectrum renderer. Scene/milkdrop kinds are React components
 *  handled separately by the host (Phase 3/4), not this interface. */
export interface Visualizer {
  readonly id: VisualizerStyleId;
  /** Called once when the style becomes active. */
  init(context: VisualizerContext): void;
  /** Draw one frame. `w`/`h` are CSS px; the host already cleared + scaled by dpr. */
  render(w: number, h: number, dtMs: number): void;
  /** Release any retained references. */
  destroy(): void;
}

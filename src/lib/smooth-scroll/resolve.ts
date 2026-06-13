import type { LenisOptions } from "lenis";
import type { AppSettings } from "@/db/types";

/**
 * Pure decision layer for smooth scrolling. The *only* place that decides
 * whether Lenis runs and with what options — UI / pages never branch on
 * `isMac()` / `settings.smoothScroll` directly (mirrors the provider /
 * visualizer / desktop-bridge registry discipline).
 */

/** Smooth-scroll strength (Lenis `lerp`) safe range. Lower = floatier/slower catch-up, higher = snappier. */
export const LERP_MIN = 0.04;
export const LERP_MAX = 0.2;
export const LERP_DEFAULT = 0.1;
/** Windows default strength — snappier ("跟手"), since smooth scroll defaults ON there. */
export const WINDOWS_LERP_DEFAULT = 0.18;

/** Coerce a stored/UI lerp into the safe range; `undefined`/`NaN`/out-of-range never break scrolling. */
export function clampLerp(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return LERP_DEFAULT;
  if (value < LERP_MIN) return LERP_MIN;
  if (value > LERP_MAX) return LERP_MAX;
  return value;
}

/** The wrapper-agnostic Lenis options this app sets. `wrapper`/`content` are supplied per-container at construction. */
export type LenisInitOptions = Pick<
  LenisOptions,
  | "lerp"
  | "smoothWheel"
  | "syncTouch"
  | "wheelMultiplier"
  | "orientation"
  | "overscroll"
  | "autoResize"
  | "anchors"
>;

/**
 * Static defaults shared by every smooth-scroll container. `lerp` is the
 * user-tunable strength and is overridden per-resolve; `syncTouch: false`
 * keeps mobile on native touch scroll (out of scope this phase).
 */
export const DEFAULT_LENIS_OPTIONS: LenisInitOptions = {
  lerp: LERP_DEFAULT,
  smoothWheel: true,
  syncTouch: false,
  wheelMultiplier: 1,
  orientation: "vertical",
  overscroll: true,
  autoResize: true,
  anchors: false,
};

/** Static base (no lerp) — exposed for tests / docs; the live options come from {@link resolveSmoothScroll}. */
export const BASE_LENIS_OPTIONS: Omit<LenisInitOptions, "lerp"> = (() => {
  const { lerp: _lerp, ...rest } = DEFAULT_LENIS_OPTIONS;
  return rest;
})();

export interface SmoothScrollEnv {
  isMac: boolean;
  /** Windows defaults smooth scroll ON (its native wheel scroll janks heavy lists). */
  isWindows: boolean;
}

export interface SmoothScrollDecision {
  /** Platform/stored intent. */
  preference: boolean;
  /** Whether Lenis should actually run. */
  enabled: boolean;
  /** Options to construct Lenis with, carrying the user's clamped strength. */
  options: LenisInitOptions;
}

export function resolveSmoothScroll(
  settings: Pick<AppSettings, "smoothScroll" | "smoothScrollLerp">,
  env: SmoothScrollEnv,
): SmoothScrollDecision {
  // Default OFF (Lenis owns a scroll rAF while active) — EXCEPT Windows, where the
  // self-stopping driver costs nothing idle and native wheel scroll janks heavy
  // lists (it recomputes the virtual window per raw event; Lenis batches per frame).
  // An explicit stored `smoothScroll` always wins. Persisted in `settings`, so the
  // choice survives reloads; the Windows default is computed (no write needed).
  const preference = settings.smoothScroll ?? env.isWindows;
  // Windows defaults to a snappier ("跟手") strength; the user-stored lerp overrides.
  const defaultLerp = env.isWindows ? WINDOWS_LERP_DEFAULT : LERP_DEFAULT;
  return {
    preference,
    enabled: preference,
    options: {
      ...DEFAULT_LENIS_OPTIONS,
      lerp: clampLerp(settings.smoothScrollLerp ?? defaultLerp),
    },
  };
}

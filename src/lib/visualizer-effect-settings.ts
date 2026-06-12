import type { AppSettings, VisualizerStyleTuning } from "@/db/types";
import type { VisualizerStyleId } from "@/visualizer/types";

export type VisualizerEffectSettings = Pick<
  AppSettings,
  | "visualizerDetail"
  | "visualizerFftSize"
  | "visualizerGlow"
  | "visualizerIntensity"
  | "visualizerMaxDecibels"
  | "visualizerMinDecibels"
  | "visualizerMirror"
  | "visualizerMotion"
  | "visualizerSmoothing"
  | "visualizerSpread"
  | "visualizerTuningByStyle"
  | "visualizerBackgroundDim"
  | "visualizerBackgroundOpacity"
  | "visualizerBgDimLyrics"
  | "visualizerBgOpacityLyrics"
>;

export interface VisualizerRenderOptions {
  detail: number;
  glow: number;
  intensity: number;
  mirror: number;
  motion: number;
  spread: number;
}

export interface VisualizerAnalyserOptions {
  fftSize: number;
  maxDecibels: number;
  minDecibels: number;
  smoothing: number;
}

export interface VisualizerAnalyserMeta {
  fftSize: number;
  maxDecibels?: number;
  minDecibels?: number;
  smoothing: number;
}

export const VISUALIZER_EFFECT_DEFAULTS: VisualizerRenderOptions = {
  detail: 1,
  glow: 1,
  intensity: 1,
  mirror: 1,
  motion: 1,
  spread: 1,
};

export const VISUALIZER_BANDS_PER_OCTAVE_DEFAULT = 3;
export const VISUALIZER_BANDS_PER_OCTAVE_MIN = 1;
export const VISUALIZER_BANDS_PER_OCTAVE_MAX = 24;
export const VISUALIZER_FFT_SIZE_OPTIONS = [256, 512, 1024, 2048] as const;

export function resolveVisualizerStyleTuning(
  settings: VisualizerEffectSettings,
  style?: VisualizerStyleId,
): VisualizerStyleTuning {
  const legacy = legacyVisualizerTuning(settings);
  if (!style) return legacy;
  return { ...legacy, ...(settings.visualizerTuningByStyle?.[style] ?? {}) };
}

export interface VisualizerBackgroundCompositeOptions {
  dimPct: number;
  opacityPct: number;
}

export function patchVisualizerStyleTuning(
  settings: VisualizerEffectSettings,
  style: VisualizerStyleId,
  patch: Partial<VisualizerStyleTuning>,
): Partial<AppSettings> {
  const current = settings.visualizerTuningByStyle ?? {};
  return {
    visualizerTuningByStyle: {
      ...current,
      [style]: {
        ...(current[style] ?? {}),
        ...patch,
      },
    },
  };
}

export function resetVisualizerStyleTuning(
  settings: VisualizerEffectSettings,
  style: VisualizerStyleId,
): Partial<AppSettings> {
  const { [style]: _removed, ...next } = settings.visualizerTuningByStyle ?? {};
  return { visualizerTuningByStyle: next };
}

export function resolveVisualizerRenderOptions(
  settings: VisualizerEffectSettings,
  style?: VisualizerStyleId,
): VisualizerRenderOptions {
  const tuning = resolveVisualizerStyleTuning(settings, style);
  return {
    detail: clamp(tuning.detail ?? VISUALIZER_EFFECT_DEFAULTS.detail, 0.125, 8),
    glow: clamp(tuning.glow ?? VISUALIZER_EFFECT_DEFAULTS.glow, 0, 2),
    intensity: clamp(tuning.intensity ?? VISUALIZER_EFFECT_DEFAULTS.intensity, 0, 2),
    mirror: clamp(tuning.mirror ?? VISUALIZER_EFFECT_DEFAULTS.mirror, 0, 2),
    motion: clamp(tuning.motion ?? VISUALIZER_EFFECT_DEFAULTS.motion, 0, 2),
    spread: clamp(tuning.spread ?? VISUALIZER_EFFECT_DEFAULTS.spread, 0.35, 2),
  };
}

export function resolveVisualizerAnalyserOptions(
  meta: VisualizerAnalyserMeta,
  settings: VisualizerEffectSettings,
  style?: VisualizerStyleId,
): VisualizerAnalyserOptions {
  const tuning = resolveVisualizerStyleTuning(settings, style);
  const min = tuning.minDecibels ?? meta.minDecibels ?? -100;
  const max = tuning.maxDecibels ?? meta.maxDecibels ?? -30;
  return {
    fftSize: normalizeFftSize(tuning.fftSize ?? meta.fftSize),
    maxDecibels: Math.max(min + 1, Math.min(0, max)),
    minDecibels: Math.min(max - 1, Math.max(-120, min)),
    smoothing: clamp(tuning.smoothing ?? meta.smoothing, 0, 0.99),
  };
}

export function resolveVisualizerBackgroundCompositeOptions(
  settings: VisualizerEffectSettings,
  style: VisualizerStyleId | undefined,
  hasLyrics: boolean,
): VisualizerBackgroundCompositeOptions {
  const tuning = resolveVisualizerStyleTuning(settings, style);
  return hasLyrics
    ? {
        dimPct: clamp(tuning.bgDimLyrics ?? 40, 0, 100),
        opacityPct: clamp(tuning.bgOpacityLyrics ?? 60, 0, 100),
      }
    : {
        dimPct: clamp(tuning.backgroundDim ?? 0, 0, 100),
        opacityPct: clamp(tuning.backgroundOpacity ?? 100, 0, 100),
      };
}

export function visualizerBandsPerOctave(detail: number): number {
  return clamp(
    Math.round(detail * VISUALIZER_BANDS_PER_OCTAVE_DEFAULT),
    VISUALIZER_BANDS_PER_OCTAVE_MIN,
    VISUALIZER_BANDS_PER_OCTAVE_MAX,
  );
}

export function visualizerDetailFromBandsPerOctave(count: number): number {
  return (
    clamp(Math.round(count), VISUALIZER_BANDS_PER_OCTAVE_MIN, VISUALIZER_BANDS_PER_OCTAVE_MAX) /
    VISUALIZER_BANDS_PER_OCTAVE_DEFAULT
  );
}

export function visualizerAuraRayCount(detail: number): number {
  return clamp(Math.round(64 * detail), 8, 512);
}

export function visualizerWaveformPointCount(detail: number): number {
  return clamp(Math.round(96 * detail), 16, 768);
}

function normalizeFftSize(value: number) {
  return VISUALIZER_FFT_SIZE_OPTIONS.includes(value as (typeof VISUALIZER_FFT_SIZE_OPTIONS)[number])
    ? value
    : 1024;
}

function legacyVisualizerTuning(settings: VisualizerEffectSettings): VisualizerStyleTuning {
  return {
    detail: settings.visualizerDetail,
    fftSize: settings.visualizerFftSize,
    glow: settings.visualizerGlow,
    intensity: settings.visualizerIntensity,
    maxDecibels: settings.visualizerMaxDecibels,
    minDecibels: settings.visualizerMinDecibels,
    mirror: settings.visualizerMirror,
    motion: settings.visualizerMotion,
    smoothing: settings.visualizerSmoothing,
    spread: settings.visualizerSpread,
    backgroundDim: settings.visualizerBackgroundDim,
    backgroundOpacity: settings.visualizerBackgroundOpacity,
    bgDimLyrics: settings.visualizerBgDimLyrics,
    bgOpacityLyrics: settings.visualizerBgOpacityLyrics,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

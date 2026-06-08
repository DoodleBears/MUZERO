import type { AppSettings } from "@/db/types";

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

export function resolveVisualizerRenderOptions(
  settings: VisualizerEffectSettings,
): VisualizerRenderOptions {
  return {
    detail: clamp(settings.visualizerDetail ?? VISUALIZER_EFFECT_DEFAULTS.detail, 0.125, 8),
    glow: clamp(settings.visualizerGlow ?? VISUALIZER_EFFECT_DEFAULTS.glow, 0, 2),
    intensity: clamp(settings.visualizerIntensity ?? VISUALIZER_EFFECT_DEFAULTS.intensity, 0, 2),
    mirror: clamp(settings.visualizerMirror ?? VISUALIZER_EFFECT_DEFAULTS.mirror, 0, 2),
    motion: clamp(settings.visualizerMotion ?? VISUALIZER_EFFECT_DEFAULTS.motion, 0, 2),
    spread: clamp(settings.visualizerSpread ?? VISUALIZER_EFFECT_DEFAULTS.spread, 0.35, 2),
  };
}

export function resolveVisualizerAnalyserOptions(
  meta: VisualizerAnalyserMeta,
  settings: VisualizerEffectSettings,
): VisualizerAnalyserOptions {
  const min = settings.visualizerMinDecibels ?? meta.minDecibels ?? -100;
  const max = settings.visualizerMaxDecibels ?? meta.maxDecibels ?? -30;
  return {
    fftSize: normalizeFftSize(settings.visualizerFftSize ?? meta.fftSize),
    maxDecibels: Math.max(min + 1, Math.min(0, max)),
    minDecibels: Math.min(max - 1, Math.max(-120, min)),
    smoothing: clamp(settings.visualizerSmoothing ?? meta.smoothing, 0, 0.99),
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

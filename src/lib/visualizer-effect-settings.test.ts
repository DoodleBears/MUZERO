import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@/db/types";
import { getVisualizerMeta } from "@/visualizer/registry";
import {
  patchVisualizerStyleTuning,
  resetVisualizerStyleTuning,
  resolveVisualizerAnalyserOptions,
  resolveVisualizerBackgroundCompositeOptions,
  resolveVisualizerRenderOptions,
  resolveVisualizerStyleTuning,
  visualizerAuraRayCount,
  visualizerBandsPerOctave,
  visualizerDetailFromBandsPerOctave,
  visualizerWaveformPointCount,
} from "./visualizer-effect-settings";

describe("visualizer density settings", () => {
  it("maps default detail to three octave bands", () => {
    expect(visualizerBandsPerOctave(1)).toBe(3);
    expect(visualizerDetailFromBandsPerOctave(3)).toBe(1);
  });

  it("starts the app on dense, tight bars for the Now Playing background", () => {
    const tuning = resolveVisualizerRenderOptions(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.visualizerStyle).toBe("bars");
    expect(DEFAULT_SETTINGS.visualizerAsBackground).toBe(true);
    expect(visualizerBandsPerOctave(tuning.detail)).toBe(24);
    expect(tuning.spread).toBe(0.35);
  });

  it("clamps octave band density to the supported range", () => {
    expect(visualizerBandsPerOctave(0)).toBe(1);
    expect(visualizerBandsPerOctave(99)).toBe(24);
    expect(visualizerDetailFromBandsPerOctave(0)).toBe(1 / 3);
    expect(visualizerDetailFromBandsPerOctave(99)).toBe(8);
  });

  it("maps detail to aura ray and waveform point density", () => {
    expect(visualizerAuraRayCount(1)).toBe(64);
    expect(visualizerAuraRayCount(0)).toBe(8);
    expect(visualizerAuraRayCount(99)).toBe(512);
    expect(visualizerWaveformPointCount(1)).toBe(96);
    expect(visualizerWaveformPointCount(0)).toBe(16);
    expect(visualizerWaveformPointCount(99)).toBe(768);
  });
});

describe("per-style visualizer tuning", () => {
  it("uses active style tuning without leaking values across styles", () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      visualizerDetail: 8,
      visualizerIntensity: 0.5,
      visualizerTuningByStyle: {
        aura: { detail: 1.25, intensity: 1.6 },
        bars: { detail: 7, glow: 0.25 },
      },
    };

    expect(resolveVisualizerRenderOptions(settings, "aura")).toMatchObject({
      detail: 1.25,
      intensity: 1.6,
      glow: 1,
    });
    expect(resolveVisualizerRenderOptions(settings, "bars")).toMatchObject({
      detail: 7,
      intensity: 0.5,
      glow: 0.25,
    });
    expect(resolveVisualizerRenderOptions(settings, "radial")).toMatchObject({
      detail: 8,
      intensity: 0.5,
      glow: 1,
    });
  });

  it("resolves analyser options from the selected style tuning", () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      visualizerFftSize: 512,
      visualizerSmoothing: 0.2,
      visualizerTuningByStyle: {
        bars: { fftSize: 2048, smoothing: 0.95, minDecibels: -70, maxDecibels: -12 },
        aura: { fftSize: 256, smoothing: 0.4 },
      },
    };

    expect(resolveVisualizerAnalyserOptions(getVisualizerMeta("bars"), settings, "bars")).toEqual({
      fftSize: 2048,
      smoothing: 0.95,
      minDecibels: -70,
      maxDecibels: -12,
    });
    expect(resolveVisualizerAnalyserOptions(getVisualizerMeta("aura"), settings, "aura")).toEqual({
      fftSize: 256,
      smoothing: 0.4,
      minDecibels: -100,
      maxDecibels: -30,
    });
  });

  it("patches only the selected style tuning", () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      visualizerTuningByStyle: {
        aura: { glow: 0.5 },
        bars: { detail: 4 },
      },
    };

    const patch = patchVisualizerStyleTuning(settings, "bars", { glow: 1.4, detail: 6 });

    expect(patch.visualizerTuningByStyle).toEqual({
      aura: { glow: 0.5 },
      bars: { detail: 6, glow: 1.4 },
    });
    expect(settings.visualizerTuningByStyle?.bars).toEqual({ detail: 4 });
  });

  it("resets only the selected style tuning", () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      visualizerTuningByStyle: {
        aura: { glow: 0.5 },
        bars: { detail: 4, glow: 1.2 },
      },
    };

    const patch = resetVisualizerStyleTuning(settings, "bars");

    expect(patch.visualizerTuningByStyle).toEqual({
      aura: { glow: 0.5 },
    });
    expect(resolveVisualizerStyleTuning({ ...settings, ...patch }, "bars")).toMatchObject({
      detail: DEFAULT_SETTINGS.visualizerDetail,
      glow: DEFAULT_SETTINGS.visualizerGlow,
    });
  });

  it("resolves per-style background opacity and dim for lyrics and no-lyrics states", () => {
    const settings: AppSettings = {
      ...DEFAULT_SETTINGS,
      visualizerBackgroundOpacity: 95,
      visualizerBackgroundDim: 5,
      visualizerBgOpacityLyrics: 55,
      visualizerBgDimLyrics: 45,
      visualizerTuningByStyle: {
        bars: {
          backgroundOpacity: 70,
          backgroundDim: 20,
          bgOpacityLyrics: 30,
          bgDimLyrics: 80,
        },
        aura: {
          backgroundOpacity: 10,
        },
      },
    };

    expect(resolveVisualizerBackgroundCompositeOptions(settings, "bars", false)).toEqual({
      dimPct: 20,
      opacityPct: 70,
    });
    expect(resolveVisualizerBackgroundCompositeOptions(settings, "bars", true)).toEqual({
      dimPct: 80,
      opacityPct: 30,
    });
    expect(resolveVisualizerBackgroundCompositeOptions(settings, "aura", true)).toEqual({
      dimPct: 45,
      opacityPct: 55,
    });
  });
});

import { describe, expect, it } from "vitest";
import {
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

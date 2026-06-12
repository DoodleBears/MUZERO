import { describe, expect, it } from "vitest";
import { createVisualizer } from "../registry";
import type { VisualizerContext } from "../types";

/**
 * jsdom has no real 2D canvas context, so we stub one to smoke-test that every
 * spectrum renderer's init()/render() path executes without throwing (catches
 * crashes typecheck can't — bad ctx calls, NaN geometry, empty-band edge cases).
 */
function makeCtx() {
  const grad = { addColorStop() {} };
  return {
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    fillRect() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    // settable style props are just assigned; no-op object tolerates them
  } as unknown as CanvasRenderingContext2D;
}

function makeAnalyser(fftSize = 1024) {
  const binCount = fftSize / 2;
  return {
    fftSize,
    frequencyBinCount: binCount,
    smoothingTimeConstant: 0.8,
    context: { sampleRate: 44100 },
    getByteFrequencyData(arr: Uint8Array) {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 7) % 256;
    },
    getByteTimeDomainData(arr: Uint8Array) {
      for (let i = 0; i < arr.length; i++) arr[i] = 128 + Math.round(40 * Math.sin(i / 5));
    },
  } as unknown as AnalyserNode;
}

function makeContext(analyser: AnalyserNode | null, active: boolean): VisualizerContext {
  return {
    canvas: {} as HTMLCanvasElement,
    ctx: makeCtx(),
    getAnalyser: () => analyser,
    primary: () => ({ r: 191, g: 131, b: 254 }),
    active: () => active,
    options: {
      detail: 1,
      intensity: 1,
      mirror: 1,
      motion: 1,
      spread: 1,
    },
  };
}

const SPECTRUM_IDS = ["bars", "radial", "led-reflex", "waveform"] as const;

describe("spectrum renderers smoke test", () => {
  for (const id of SPECTRUM_IDS) {
    it(`${id} runs init + render (active) without throwing`, () => {
      const viz = createVisualizer(id);
      expect(viz).not.toBeNull();
      const ctx = makeContext(makeAnalyser(), true);
      expect(() => {
        viz?.init(ctx);
        viz?.render(300, 150, 16);
        viz?.render(300, 150, 16); // second frame exercises smoothing + frame counter
        viz?.destroy();
      }).not.toThrow();
    });

    it(`${id} runs idle (no analyser, inactive) without throwing`, () => {
      const viz = createVisualizer(id);
      const ctx = makeContext(null, false);
      expect(() => {
        viz?.init(ctx);
        viz?.render(300, 150, 16);
        viz?.destroy();
      }).not.toThrow();
    });
  }
});

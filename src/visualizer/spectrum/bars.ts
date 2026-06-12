import { lighten, type Rgb, rgba } from "@/lib/visualizer-color";
import { visualizerBandsPerOctave } from "@/lib/visualizer-effect-settings";
import type { Visualizer, VisualizerContext } from "../types";
import {
  aggregateBandsInto,
  applyTiltInto,
  type Band,
  decayBandsInto,
  octaveBands,
  smoothBandsInto,
  tiltWeights,
} from "./bands";

/**
 * Bars — classic octave-band spectrum bars rising from the bottom, colored with
 * the `--primary` accent (deeper at the base, brighter at the tip). Log/octave
 * grouping + perceptual tilt + EMA smoothing (see bands.ts).
 */
export function createBarsVisualizer(): Visualizer {
  let c: VisualizerContext | null = null;
  let data = new Uint8Array(512);
  let bands: Band[] = [];
  let weights: number[] = [];
  let levels: number[] = [];
  // Reused per-frame target buffer — the render loop allocates nothing (F-10).
  const scratch: number[] = [];
  let primary: Rgb = { r: 191, g: 131, b: 254 };
  let frame = 0;
  let bandsPerOctave = 0;

  const rebuild = (analyser: AnalyserNode, detail: number) => {
    bandsPerOctave = visualizerBandsPerOctave(detail);
    bands = octaveBands({
      bandsPerOctave,
      fftSize: analyser.fftSize,
      sampleRate: analyser.context.sampleRate,
    });
    weights = tiltWeights(bands.length);
    levels = new Array(bands.length).fill(0);
    if (data.length !== analyser.frequencyBinCount)
      data = new Uint8Array(analyser.frequencyBinCount);
  };

  return {
    id: "bars",
    init(ctx) {
      c = ctx;
      primary = ctx.primary();
      const a = ctx.getAnalyser();
      if (a) rebuild(a, ctx.options.detail);
    },
    render(w, h) {
      if (!c) return;
      const ctx = c.ctx;
      const options = c.options;
      if (frame++ % (c.smoothPrimary?.() ? 1 : 6) === 0) primary = c.primary();
      const analyser = c.getAnalyser();
      const active = c.active();
      const nextBandsPerOctave = visualizerBandsPerOctave(options.detail);
      if (
        analyser &&
        (bands.length === 0 ||
          data.length !== analyser.frequencyBinCount ||
          bandsPerOctave !== nextBandsPerOctave)
      ) {
        rebuild(analyser, options.detail);
      }

      if (analyser && active && bands.length) {
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        aggregateBandsInto(scratch, data, bands);
        applyTiltInto(scratch, weights);
        smoothBandsInto(levels, scratch, Math.max(0.15, Math.min(0.9, 0.5 * options.motion)));
      } else {
        // No audio: sink to rest instead of faking idle motion.
        decayBandsInto(levels);
      }

      const n = levels.length || 1;
      const gap = Math.max(1, w * 0.004 * options.spread);
      const bw = Math.max(1, (w - gap * (n - 1)) / n);
      const tip = lighten(primary, 0.4);
      const background = c.placement === "background";
      // The background baseline keeps bars visible while there's sound, but
      // fades with the overall level so a paused track sinks to the floor.
      const peak = levels.reduce((m, v) => (v > m ? v : m), 0);
      const baseline = background ? h * 0.08 * Math.min(1, peak / 0.1) : 0;
      for (let i = 0; i < levels.length; i++) {
        const level = Math.min(1, Math.max(0, (levels[i] ?? 0) * options.intensity));
        const bh = background ? Math.max(baseline, level * h) : Math.max(1, level * h * 0.92);
        const x = i * (bw + gap);
        const y = background ? (h - bh) / 2 : h - bh;
        const g = ctx.createLinearGradient(0, background ? y + bh : h, 0, y);
        g.addColorStop(0, rgba(primary, 0.85));
        g.addColorStop(1, rgba(tip, 0.98));
        ctx.fillStyle = g;
        ctx.fillRect(x, y, bw, bh);
      }
    },
    destroy() {
      c = null;
    },
  };
}

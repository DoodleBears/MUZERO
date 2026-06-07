import { lighten, type Rgb, rgba } from "@/lib/visualizer-color";
import type { Visualizer, VisualizerContext } from "../types";
import {
  aggregateBands,
  applyTilt,
  type Band,
  octaveBands,
  smoothBands,
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
  let primary: Rgb = { r: 191, g: 131, b: 254 };
  let frame = 0;

  const rebuild = (analyser: AnalyserNode) => {
    bands = octaveBands({ fftSize: analyser.fftSize, sampleRate: analyser.context.sampleRate });
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
      if (a) rebuild(a);
    },
    render(w, h) {
      if (!c) return;
      const ctx = c.ctx;
      if (frame++ % 30 === 0) primary = c.primary();
      const analyser = c.getAnalyser();
      const active = c.active();
      if (analyser && (bands.length === 0 || data.length !== analyser.frequencyBinCount)) {
        rebuild(analyser);
      }

      let target: number[];
      if (analyser && active && bands.length) {
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        target = applyTilt(aggregateBands(data, bands), weights);
      } else {
        const t = Date.now() / 600;
        const n = Math.max(bands.length, 24);
        target = Array.from({ length: n }, (_, i) => 0.04 + 0.03 * Math.abs(Math.sin(t + i * 0.3)));
      }
      levels = smoothBands(levels, target, 0.5);

      const n = levels.length || 1;
      const gap = Math.max(1, w * 0.004);
      const bw = Math.max(1, (w - gap * (n - 1)) / n);
      const tip = lighten(primary, 0.4);
      for (let i = 0; i < levels.length; i++) {
        const bh = Math.max(1, levels[i] * h * 0.92);
        const x = i * (bw + gap);
        const y = h - bh;
        const g = ctx.createLinearGradient(0, h, 0, y);
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

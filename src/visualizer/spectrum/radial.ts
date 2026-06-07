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
 * Radial — an octave-band spectrum wrapped into a circle: bars radiate outward
 * from a soft `--primary` core, slowly rotating. Reads richer than flat bars and
 * fills a square stage well.
 */
export function createRadialVisualizer(): Visualizer {
  let c: VisualizerContext | null = null;
  let data = new Uint8Array(512);
  let bands: Band[] = [];
  let weights: number[] = [];
  let levels: number[] = [];
  let primary: Rgb = { r: 191, g: 131, b: 254 };
  let frame = 0;
  let spin = 0;

  const rebuild = (analyser: AnalyserNode) => {
    bands = octaveBands({ fftSize: analyser.fftSize, sampleRate: analyser.context.sampleRate });
    weights = tiltWeights(bands.length);
    levels = new Array(bands.length).fill(0);
    if (data.length !== analyser.frequencyBinCount)
      data = new Uint8Array(analyser.frequencyBinCount);
  };

  return {
    id: "radial",
    init(ctx) {
      c = ctx;
      primary = ctx.primary();
      const a = ctx.getAnalyser();
      if (a) rebuild(a);
    },
    render(w, h) {
      if (!c) return;
      const ctx = c.ctx;
      const options = c.options;
      if (frame++ % (c.smoothPrimary?.() ? 1 : 6) === 0) primary = c.primary();
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
        const t = Date.now() / 700;
        const n = Math.max(bands.length, 32);
        target = Array.from({ length: n }, (_, i) => 0.05 + 0.04 * Math.abs(Math.sin(t + i * 0.4)));
      }
      levels = smoothBands(levels, target, Math.max(0.15, Math.min(0.9, 0.5 * options.motion)));
      spin += 0.0015 * options.motion;

      const cx = w / 2;
      const cy = h / 2;
      const inner = Math.min(w, h) * 0.16 * options.spread;
      const reach = Math.min(w, h) * 0.32 * options.intensity;
      const energy = levels.reduce((s, v) => s + v, 0) / (levels.length || 1);
      const tip = lighten(primary, 0.4);

      // Soft pulsing core.
      const coreR = inner * (0.7 + energy * 0.6);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
      grad.addColorStop(
        0,
        rgba(lighten(primary, 0.5), Math.min(1, (0.5 + energy * 0.4) * options.glow)),
      );
      grad.addColorStop(1, rgba(primary, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Mirror the spectrum across the circle so both halves are symmetric.
      const n = levels.length || 1;
      const total = n * 2;
      ctx.lineWidth = Math.max(1.5, (Math.PI * inner) / total);
      ctx.lineCap = "round";
      for (let k = 0; k < total; k++) {
        const i = k < n ? k : total - 1 - k;
        const v = levels[i] ?? 0;
        const angle = (k / total) * Math.PI * 2 + spin;
        const r0 = inner;
        const r1 = inner + v * reach;
        ctx.strokeStyle = rgba(tip, Math.min(1, (0.35 + v * 0.6) * options.glow));
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
        ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        ctx.stroke();
      }
    },
    destroy() {
      c = null;
    },
  };
}

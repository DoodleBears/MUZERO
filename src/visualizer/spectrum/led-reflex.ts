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
 * LED + Reflex — segmented "LED" octave bars sitting on a baseline, with a faded
 * mirrored reflection below (the Poweramp/audioMotion "reflex" look). All
 * `--primary`-tinted.
 */
export function createLedReflexVisualizer(): Visualizer {
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
    id: "led-reflex",
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
        // No audio: let the LEDs fall back to the baseline instead of faking motion.
        decayBandsInto(levels);
      }

      const n = levels.length || 1;
      const baseline = h * 0.66;
      const upMax = baseline * 0.96;
      const downMax = (h - baseline) * 0.9;
      const gap = Math.max(1, w * 0.004 * options.spread);
      const bw = Math.max(1, (w - gap * (n - 1)) / n);
      const segH = Math.max(3, h * 0.022);
      const segGap = Math.max(1, segH * 0.4);
      const step = segH + segGap;
      const tip = lighten(primary, 0.45);

      for (let i = 0; i < levels.length; i++) {
        const v = Math.min(1, (levels[i] ?? 0) * options.intensity);
        const x = i * (bw + gap);
        const litUp = Math.floor((v * upMax) / step);
        for (let s = 0; s <= litUp; s++) {
          const y = baseline - (s + 1) * step + segGap;
          const f = s / Math.max(1, upMax / step); // 0 base → 1 top
          ctx.fillStyle = rgba(lighten(primary, 0.45 * f), Math.min(1, 0.92 * options.glow));
          ctx.fillRect(x, y, bw, segH);
        }
        // Reflection (dimmer, shorter).
        const litDown = Math.floor((v * downMax) / step);
        for (let s = 0; s <= litDown; s++) {
          const y = baseline + s * step + segGap;
          const fade = 0.35 * options.mirror * (1 - s / Math.max(1, downMax / step));
          ctx.fillStyle = rgba(tip, Math.max(0, fade));
          ctx.fillRect(x, y, bw, segH);
        }
      }
    },
    destroy() {
      c = null;
    },
  };
}

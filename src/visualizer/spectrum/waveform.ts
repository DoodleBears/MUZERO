import { lighten, type Rgb, rgba } from "@/lib/visualizer-color";
import { visualizerWaveformPointCount } from "@/lib/visualizer-effect-settings";
import type { Visualizer, VisualizerContext } from "../types";

/**
 * Waveform — a time-domain oscilloscope line that wiggles with the audio,
 * mirrored top/bottom and glowing in the `--primary` accent. Uses
 * `getByteTimeDomainData` (raw samples), not the frequency spectrum.
 */
export function createWaveformVisualizer(): Visualizer {
  let c: VisualizerContext | null = null;
  let data = new Uint8Array(1024);
  let primary: Rgb = { r: 191, g: 131, b: 254 };
  let frame = 0;

  return {
    id: "waveform",
    init(ctx) {
      c = ctx;
      primary = ctx.primary();
      const a = ctx.getAnalyser();
      if (a && data.length !== a.fftSize) data = new Uint8Array(a.fftSize);
    },
    render(w, h) {
      if (!c) return;
      const ctx = c.ctx;
      const options = c.options;
      if (frame++ % (c.smoothPrimary?.() ? 1 : 6) === 0) primary = c.primary();
      const analyser = c.getAnalyser();
      const active = c.active();
      const mid = h / 2;
      const amp = h * 0.4 * options.intensity;

      // Sample the waveform into [-1, 1] across the width.
      const N = visualizerWaveformPointCount(options.detail);
      const pts: number[] = new Array(N);
      if (analyser && active) {
        if (data.length !== analyser.fftSize) data = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(data as Uint8Array<ArrayBuffer>);
        for (let i = 0; i < N; i++) {
          const idx = Math.floor((i / (N - 1)) * (data.length - 1));
          pts[i] = (data[idx] - 128) / 128;
        }
      } else {
        const t = (Date.now() / 500) * options.motion;
        for (let i = 0; i < N; i++) {
          const x = i / (N - 1);
          pts[i] = 0.06 * Math.sin(x * Math.PI * 4 + t) * Math.sin(x * Math.PI);
        }
      }

      const drawLine = (sign: number, alpha: number, lift: Rgb) => {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * w;
          const y = mid + sign * pts[i] * amp;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = rgba(lift, alpha);
        ctx.stroke();
      };

      ctx.lineWidth = Math.max(1.5, h * 0.006);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.shadowBlur = h * 0.03 * options.glow;
      ctx.shadowColor = rgba(lighten(primary, 0.2), Math.min(1, 0.6 * options.glow));
      drawLine(1, Math.min(1, 0.95 * options.glow), lighten(primary, 0.3));
      drawLine(-1, Math.min(1, 0.4 * options.mirror * options.glow), primary);
      ctx.shadowBlur = 0;
    },
    destroy() {
      c = null;
    },
  };
}

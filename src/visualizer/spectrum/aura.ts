import { lighten, type Rgb, rgba } from "@/lib/visualizer-color";
import type { Visualizer, VisualizerContext } from "../types";

/**
 * Aura — a radial frequency "bloom" driven by the player's AnalyserNode. This is
 * the original MUZERO visualizer, ported into the Visualizer interface so it's
 * the registry's first canvas-2D renderer. Palette derives from `--primary`.
 */
export function createAuraVisualizer(): Visualizer {
  let c: VisualizerContext | null = null;
  let data = new Uint8Array(128);
  let tint: Rgb = { r: 191, g: 131, b: 254 };
  let bright: Rgb = lighten(tint, 0.3);
  let frame = 0;

  const refreshPalette = () => {
    if (!c) return;
    tint = c.primary();
    bright = lighten(tint, 0.3);
  };

  return {
    id: "aura",
    init(context) {
      c = context;
      const bins = context.getAnalyser()?.frequencyBinCount ?? 128;
      data = new Uint8Array(bins);
      frame = 0;
      refreshPalette();
    },
    render(w, h) {
      if (!c) return;
      const ctx = c.ctx;
      // Re-read --primary periodically (getComputedStyle forces a style recalc),
      // so Settings changes and cover-color tweens are reflected smoothly.
      if (frame++ % (c.smoothPrimary?.() ? 1 : 6) === 0) refreshPalette();

      const analyser = c.getAnalyser();
      const active = c.active();
      const options = c.options;

      let level = 0;
      if (analyser && active) {
        if (data.length !== analyser.frequencyBinCount) {
          data = new Uint8Array(analyser.frequencyBinCount);
        }
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        for (let i = 0; i < data.length; i++) level += data[i];
        level = level / data.length / 255; // 0..1
      } else {
        // Gentle idle breathing when nothing is playing.
        level = 0.06 + 0.04 * Math.abs(Math.sin(Date.now() / 900));
      }

      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.28 * options.spread;
      const radius = base * (1 + level * 1.4 * options.intensity);
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      grad.addColorStop(0, rgba(bright, Math.min(1, (0.55 + level * 0.4) * options.glow)));
      grad.addColorStop(0.6, rgba(tint, Math.min(1, (0.25 + level * 0.3) * options.glow)));
      grad.addColorStop(1, rgba(tint, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Frequency ring.
      if (analyser && active) {
        const bars = Math.max(16, Math.min(128, Math.round(64 * options.detail)));
        ctx.lineWidth = 2;
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * data.length)] / 255;
          const angle = (i / bars) * Math.PI * 2;
          const r0 = base * 1.05;
          const r1 = r0 + v * base * 0.8 * options.intensity;
          ctx.strokeStyle = rgba(bright, Math.min(1, (0.3 + v * 0.7) * options.glow));
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
          ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
          ctx.stroke();
        }
      }
    },
    destroy() {
      c = null;
    },
  };
}

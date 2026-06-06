import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { getAudioEngine } from "@/stores/player-store";

/**
 * Aura-style audio visualizer — a radial frequency bloom driven by the player's
 * WebAudio AnalyserNode (the actual locally-generated audio that's playing).
 *
 * Why custom instead of LiveKit's Aura: the official component
 *   pnpm dlx shadcn@latest add @agents-ui/agent-audio-visualizer-aura
 * (registry @agents-ui, configured in components.json) is shader-based and
 * designed to visualize a LiveKit WebRTC *agent audio track*, which requires a
 * LiveKit room + livekit-client. MUZERO is local-first and plays generated WAVs
 * through an HTMLAudioElement, so an analyser-tap is the right fit and keeps the
 * app cloud-free. If you later add LiveKit audio, drop that component in here.
 */
export function AuraVisualizer({ className, active }: { className?: string; active: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    const data = new Uint8Array(128);

    const render = () => {
      raf = requestAnimationFrame(render);
      const analyser = getAudioEngine()?.getAnalyser();
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      let level = 0;
      if (analyser && active) {
        analyser.getByteFrequencyData(data as Uint8Array<ArrayBuffer>);
        for (let i = 0; i < data.length; i++) level += data[i];
        level = level / data.length / 255; // 0..1
      } else {
        // Gentle idle breathing when nothing is playing.
        level = 0.06 + 0.04 * Math.abs(Math.sin(Date.now() / 900));
      }

      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.28;
      const radius = base * (1 + level * 1.4);
      const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius);
      grad.addColorStop(0, `rgba(192, 132, 252, ${0.55 + level * 0.4})`);
      grad.addColorStop(0.6, `rgba(139, 92, 246, ${0.25 + level * 0.3})`);
      grad.addColorStop(1, "rgba(139, 92, 246, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();

      // Frequency ring.
      if (analyser && active) {
        const bars = 64;
        ctx.lineWidth = 2;
        for (let i = 0; i < bars; i++) {
          const v = data[Math.floor((i / bars) * data.length)] / 255;
          const angle = (i / bars) * Math.PI * 2;
          const r0 = base * 1.05;
          const r1 = r0 + v * base * 0.8;
          ctx.strokeStyle = `rgba(216, 180, 254, ${0.3 + v * 0.7})`;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(angle) * r0, cy + Math.sin(angle) * r0);
          ctx.lineTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
          ctx.stroke();
        }
      }
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
}

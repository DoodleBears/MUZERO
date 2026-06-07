import { useEffect, useRef } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { readPrimaryRgb } from "@/lib/visualizer-color";
import { getMediaEngine } from "@/stores/player-store";
import { createVisualizer, getVisualizerMeta, resolveVisualizerStyle } from "./registry";
import type { VisualizerStyleId } from "./types";

/**
 * Whether the rAF loop should run. We pause when the tab is hidden, when the
 * canvas is scrolled off-screen, or under reduced-motion — audio keeps playing
 * regardless (a media-playing tab is exempt from the browser's auto-throttle, so
 * we must pause drawing ourselves). Pure so it's unit-tested.
 */
export function shouldAnimate(s: {
  hidden: boolean;
  onscreen: boolean;
  reducedMotion: boolean;
}): boolean {
  return !s.hidden && s.onscreen && !s.reducedMotion;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Hosts the active visualizer: owns the <canvas>, the single rAF loop, dpr
 * scaling + clearing, analyser configuration, visibility/offscreen/reduced-motion
 * pausing, and `--primary` injection. Reads the chosen style from settings
 * (or an explicit `styleId` override, used by callers/tests). "off" renders nothing.
 */
export function VisualizerHost({
  active,
  className,
  styleId,
}: {
  active: boolean;
  className?: string;
  styleId?: VisualizerStyleId;
}) {
  const settings = useSettings();
  const style = resolveVisualizerStyle(styleId ?? settings.visualizerStyle);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Read `active` inside the loop without re-running the effect on play/pause.
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (style === "off") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // no 2D support (e.g. jsdom)

    const meta = getVisualizerMeta(style);
    const viz = createVisualizer(style);
    if (!viz) return;

    viz.init({
      canvas,
      ctx,
      getAnalyser: () => getMediaEngine()?.getAnalyser() ?? null,
      primary: readPrimaryRgb,
      active: () => activeRef.current,
      reducedMotion: prefersReducedMotion,
    });

    let raf = 0;
    let running = false;
    let last = 0;
    let onscreen = true;

    const drawOne = (t: number) => {
      // Configure the shared analyser lazily — it may be built only on first play,
      // after init. Set once; subsequent frames already match.
      const a = getMediaEngine()?.getAnalyser();
      if (a && a.fftSize !== meta.fftSize) {
        a.fftSize = meta.fftSize;
        a.smoothingTimeConstant = meta.smoothing;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const dt = last ? t - last : 16;
      last = t;
      viz.render(w, h, dt);
    };

    const loop = (t: number) => {
      drawOne(t);
      raf = requestAnimationFrame(loop);
    };

    const sync = () => {
      const animate = shouldAnimate({
        hidden: typeof document !== "undefined" && document.hidden,
        onscreen,
        reducedMotion: prefersReducedMotion(),
      });
      if (animate && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!animate && running) {
        running = false;
        cancelAnimationFrame(raf);
        requestAnimationFrame(drawOne); // leave a static frame, not a blank canvas
      }
    };

    const onVisibility = () => sync();
    document.addEventListener("visibilitychange", onVisibility);

    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          onscreen = entries[0]?.isIntersecting ?? true;
          sync();
        },
        { threshold: 0 },
      );
      io.observe(canvas);
    }

    const mq =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const onMq = () => sync();
    mq?.addEventListener?.("change", onMq);

    requestAnimationFrame(drawOne); // always paint at least one frame
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      io?.disconnect();
      mq?.removeEventListener?.("change", onMq);
      viz.destroy();
    };
  }, [style]);

  if (style === "off") return null;
  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
}

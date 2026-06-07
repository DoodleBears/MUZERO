import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { cn } from "@/lib/utils";
import { readPrimaryRgb } from "@/lib/visualizer-color";
import { getMediaEngine } from "@/stores/player-store";
import { createVisualizer, getVisualizerMeta, resolveVisualizerStyle } from "./registry";
import type { VisualizerStyleId } from "./types";

const ReactiveScene = lazy(() => import("./scene/reactive-scene"));

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

/** Reactive reduced-motion preference (jsdom-safe; returns false without matchMedia). */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduce(mq.matches);
    const onChange = () => setReduce(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduce;
}

function hasWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Canvas-2D spectrum renderer host: owns the <canvas>, the single rAF loop, dpr
 * scaling + clearing, analyser configuration, visibility/offscreen/reduced-motion
 * pausing, and `--primary` injection. `styleId` is always a concrete spectrum id.
 */
function SpectrumCanvas({
  styleId,
  active,
  className,
}: {
  styleId: VisualizerStyleId;
  active: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // no 2D support (e.g. jsdom)

    const meta = getVisualizerMeta(styleId);
    const viz = createVisualizer(styleId);
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
    let configured = false;

    const drawOne = (t: number) => {
      const a = getMediaEngine()?.getAnalyser();
      if (a && !configured) {
        a.fftSize = meta.fftSize;
        a.smoothingTimeConstant = meta.smoothing;
        a.minDecibels = meta.minDecibels ?? -100;
        a.maxDecibels = meta.maxDecibels ?? -30;
        configured = true;
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
  }, [styleId]);

  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
}

/**
 * GPU scene host: lazy-loads the R3F scene (keeps three out of the main bundle),
 * pauses it when off-screen or under reduced-motion, and falls back to the aura
 * spectrum when WebGL is unavailable.
 */
function SceneHost({
  styleId,
  active,
  className,
}: {
  styleId: VisualizerStyleId;
  active: boolean;
  className?: string;
}) {
  const ok = useMemo(() => hasWebGL(), []);
  const ref = useRef<HTMLDivElement | null>(null);
  const [onscreen, setOnscreen] = useState(true);
  const reduce = usePrefersReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setOnscreen(entries[0]?.isIntersecting ?? true),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!ok) return <SpectrumCanvas styleId="aura" active={active} className={className} />;

  const meta = getVisualizerMeta(styleId);
  const paused = !onscreen || reduce;
  return (
    <div ref={ref} className={cn("h-full w-full", className)} aria-hidden>
      <Suspense fallback={null}>
        <ReactiveScene
          styleId={styleId}
          active={active}
          paused={paused}
          fftSize={meta.fftSize}
          smoothing={meta.smoothing}
        />
      </Suspense>
    </div>
  );
}

/**
 * Hosts the active visualizer. Reads the chosen style from settings (or an
 * explicit `styleId` override, used by callers/tests) and dispatches: "off"
 * renders nothing; scene kinds get the GPU host; everything else the canvas-2D host.
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
  if (style === "off") return null;
  if (getVisualizerMeta(style).kind === "scene") {
    return <SceneHost styleId={style} active={active} className={className} />;
  }
  return <SpectrumCanvas styleId={style} active={active} className={className} />;
}

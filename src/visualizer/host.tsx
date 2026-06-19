import { type CSSProperties, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useVisualizerCoverColorCss } from "@/components/player/visualizer-dynamic-color";
import { useSettings } from "@/hooks/use-app-data";
import { type FlowConfig, resolveFlowConfig } from "@/lib/flow-config";
import { cn } from "@/lib/utils";
import { DYNAMIC_PRIMARY_CSS_VAR, type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import {
  resolveVisualizerAnalyserOptions,
  resolveVisualizerRenderOptions,
  type VisualizerEffectSettings,
} from "@/lib/visualizer-effect-settings";
import { getMediaEngine } from "@/stores/player-store";
import { getVisualizerCoverColorRgb } from "@/stores/visualizer-color-store";
import { createVisualizer, getVisualizerMeta, resolveVisualizerStyle } from "./registry";
import type { VisualizerPlacement, VisualizerStyleId } from "./types";

const ReactiveScene = lazy(() => import("./scene/reactive-scene"));

/**
 * Whether the rAF loop should run. We pause when the tab is hidden or when the
 * canvas is scrolled off-screen. OS reduced-motion is not part of this decision:
 * the visualizer is a user-toggleable playback surface.
 */
export function shouldAnimate(s: { active: boolean; hidden: boolean; onscreen: boolean }): boolean {
  return s.active && !s.hidden && s.onscreen;
}

export function shouldPaintStaticFrame(s: { hidden: boolean; onscreen: boolean }): boolean {
  return !s.hidden && s.onscreen;
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
 * scaling + clearing, analyser configuration, visibility/offscreen pausing, and
 * `--primary` injection. `styleId` is always a concrete spectrum id.
 */
function SpectrumCanvas({
  styleId,
  active,
  className,
  coverColor = false,
  effectSettings,
  placement = "surface",
}: {
  styleId: VisualizerStyleId;
  active: boolean;
  className?: string;
  coverColor?: boolean;
  effectSettings: VisualizerEffectSettings;
  placement?: VisualizerPlacement;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  const syncRef = useRef<(() => void) | null>(null);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // no 2D support (e.g. jsdom)

    const meta = getVisualizerMeta(styleId);
    const analyserOptions = resolveVisualizerAnalyserOptions(meta, effectSettings, styleId);
    const renderOptions = resolveVisualizerRenderOptions(effectSettings, styleId);
    const viz = createVisualizer(styleId);
    if (!viz) return;

    // Glide the cover-derived primary toward the new song's color instead of snapping
    // when the color store settles, so the spectrum recolors smoothly to the next cover
    // (matches the flow palette glide; PM: "频谱颜色希望过渡到下一张"). Frame-rate
    // independent (tau-based); the renderers call primary() once per frame when coverColor.
    // The theme color path (coverColor=false) is static and returns directly.
    const PRIMARY_GLIDE_TAU_MS = 320;
    let smoothedPrimary: Rgb | null = null;
    let lastPrimaryTs = 0;
    const glidePrimary = (): Rgb => {
      const target = getVisualizerCoverColorRgb() ?? readPrimaryRgb(canvas);
      const now = typeof performance !== "undefined" ? performance.now() : 0;
      if (!smoothedPrimary) {
        smoothedPrimary = { ...target };
      } else {
        const dt = lastPrimaryTs ? now - lastPrimaryTs : 16;
        const k = 1 - Math.exp(-dt / PRIMARY_GLIDE_TAU_MS);
        smoothedPrimary = {
          r: Math.round(smoothedPrimary.r + (target.r - smoothedPrimary.r) * k),
          g: Math.round(smoothedPrimary.g + (target.g - smoothedPrimary.g) * k),
          b: Math.round(smoothedPrimary.b + (target.b - smoothedPrimary.b) * k),
        };
      }
      lastPrimaryTs = now;
      return smoothedPrimary;
    };

    viz.init({
      canvas,
      ctx,
      getAnalyser: () => getMediaEngine()?.getAnalyser() ?? null,
      primary: () => (coverColor ? glidePrimary() : readPrimaryRgb(canvas)),
      smoothPrimary: () => coverColor,
      active: () => activeRef.current,
      placement,
      options: renderOptions,
    });

    let raf = 0;
    let running = false;
    let last = 0;
    let onscreen = true;
    let configured = false;

    const drawOne = (t: number) => {
      const a = getMediaEngine()?.getAnalyser();
      if (a && !configured) {
        a.fftSize = analyserOptions.fftSize;
        a.smoothingTimeConstant = analyserOptions.smoothing;
        a.minDecibels = analyserOptions.minDecibels;
        a.maxDecibels = analyserOptions.maxDecibels;
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
        active: activeRef.current,
        hidden: typeof document !== "undefined" && document.hidden,
        onscreen,
      });
      if (animate && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      } else if (!animate && running) {
        running = false;
        cancelAnimationFrame(raf);
        if (
          shouldPaintStaticFrame({
            hidden: typeof document !== "undefined" && document.hidden,
            onscreen,
          })
        ) {
          requestAnimationFrame(drawOne); // leave a static frame, not a blank canvas
        }
      }
    };
    syncRef.current = sync;

    sync();

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

    requestAnimationFrame(drawOne); // always paint at least one frame
    sync();

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      if (syncRef.current === sync) syncRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      io?.disconnect();
      viz.destroy();
    };
  }, [styleId, coverColor, placement, effectSettings]);

  useEffect(() => {
    syncRef.current?.();
  });

  return <canvas ref={canvasRef} className={cn("h-full w-full", className)} aria-hidden />;
}

/**
 * GPU scene host: lazy-loads the R3F scene (keeps three out of the main bundle),
 * pauses it when off-screen, and falls back to the bars spectrum when WebGL is
 * unavailable.
 */
function SceneHost({
  styleId,
  active,
  className,
  effectSettings,
  flow,
  placement = "surface",
}: {
  styleId: VisualizerStyleId;
  active: boolean;
  className?: string;
  effectSettings: VisualizerEffectSettings;
  flow?: FlowConfig;
  placement?: VisualizerPlacement;
}) {
  const ok = useMemo(() => hasWebGL(), []);
  const ref = useRef<HTMLDivElement | null>(null);
  const [onscreen, setOnscreen] = useState(true);
  // Memoize so the options identity is STABLE across re-renders (the background
  // re-renders on every song switch). An unstable `options` would churn the scene's
  // render-loop effect dep → the rAF loop restarts every switch. `effectSettings` is
  // already memoized by the host, so these only change on a real tuning/style change.
  const analyserOptions = useMemo(
    () => resolveVisualizerAnalyserOptions(getVisualizerMeta(styleId), effectSettings, styleId),
    [effectSettings, styleId],
  );
  const renderOptions = useMemo(
    () => resolveVisualizerRenderOptions(effectSettings, styleId),
    [effectSettings, styleId],
  );

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

  if (!ok) {
    return (
      <SpectrumCanvas
        styleId="bars"
        active={active}
        className={className}
        effectSettings={effectSettings}
      />
    );
  }

  const paused = !active || !onscreen;
  return (
    <div ref={ref} className={cn("h-full w-full", className)} aria-hidden>
      <Suspense fallback={null}>
        <ReactiveScene
          styleId={styleId}
          active={active}
          paused={paused}
          fftSize={analyserOptions.fftSize}
          smoothing={analyserOptions.smoothing}
          options={renderOptions}
          flow={flow}
          placement={placement}
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
  coverColor = false,
  className,
  placement = "surface",
  style: hostStyle,
  styleId,
}: {
  active: boolean;
  coverColor?: boolean;
  className?: string;
  placement?: VisualizerPlacement;
  style?: CSSProperties;
  styleId?: VisualizerStyleId;
}) {
  const settings = useSettings();
  const coverColorCss = useVisualizerCoverColorCss(coverColor);
  const resolvedStyle = resolveVisualizerStyle(styleId ?? settings.visualizerStyle);
  const effectSettings = useMemo(
    () => ({
      visualizerDetail: settings.visualizerDetail,
      visualizerFftSize: settings.visualizerFftSize,
      visualizerIntensity: settings.visualizerIntensity,
      visualizerMaxDecibels: settings.visualizerMaxDecibels,
      visualizerMinDecibels: settings.visualizerMinDecibels,
      visualizerMirror: settings.visualizerMirror,
      visualizerMotion: settings.visualizerMotion,
      visualizerSmoothing: settings.visualizerSmoothing,
      visualizerSpread: settings.visualizerSpread,
      visualizerTuningByStyle: settings.visualizerTuningByStyle,
    }),
    [
      settings.visualizerDetail,
      settings.visualizerFftSize,
      settings.visualizerIntensity,
      settings.visualizerMaxDecibels,
      settings.visualizerMinDecibels,
      settings.visualizerMirror,
      settings.visualizerMotion,
      settings.visualizerSmoothing,
      settings.visualizerSpread,
      settings.visualizerTuningByStyle,
    ],
  );
  const flow = useMemo(
    () =>
      resolveFlowConfig({
        flowColorSource: settings.flowColorSource,
        flowCustomColors: settings.flowCustomColors,
        flowEffect: settings.flowEffect,
        flowMotion: settings.flowMotion,
        flowScale: settings.flowScale,
        flowAudioReactivity: settings.flowAudioReactivity,
      }),
    [
      settings.flowColorSource,
      settings.flowCustomColors,
      settings.flowEffect,
      settings.flowMotion,
      settings.flowScale,
      settings.flowAudioReactivity,
    ],
  );
  if (resolvedStyle === "off") return null;
  const scopedColorStyle = coverColorCss
    ? ({ [DYNAMIC_PRIMARY_CSS_VAR]: coverColorCss } as CSSProperties)
    : undefined;
  const wrapperStyle = scopedColorStyle ? { ...hostStyle, ...scopedColorStyle } : hostStyle;
  const hostClassName = cn("h-full w-full", className);
  if (getVisualizerMeta(resolvedStyle).kind === "scene") {
    return (
      <div className={hostClassName} style={wrapperStyle}>
        <SceneHost
          styleId={resolvedStyle}
          active={active}
          effectSettings={effectSettings}
          flow={flow}
          placement={placement}
        />
      </div>
    );
  }
  return (
    <div className={hostClassName} style={wrapperStyle}>
      <SpectrumCanvas
        styleId={resolvedStyle}
        active={active}
        coverColor={coverColor}
        effectSettings={effectSettings}
        placement={placement}
      />
    </div>
  );
}

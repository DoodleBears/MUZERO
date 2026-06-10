import { useEffect, useRef } from "react";
import * as twgl from "twgl.js";
import { type FlowConfig, resolveFlowColors } from "@/lib/flow-config";
import { darken, lighten, type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import type { VisualizerRenderOptions } from "@/lib/visualizer-effect-settings";
import { getMediaEngine } from "@/stores/player-store";
import { getVisualizerCoverPalette } from "@/stores/visualizer-color-store";
import { computeAudioUniforms } from "./audio-uniforms";
import { DEFAULT_FLOW_EFFECT, FLOW_FRAGS } from "./flow-shaders";
import { AURORA_FRAG, LIQUID_FRAG, SCENE_VERT } from "./scene-shaders";

/** Matches `#define FLOW_MAX_COLORS` in the flow shaders. */
const FLOW_MAX_COLORS = 5;

/**
 * Audio-reactive GPU scene — one full-screen fragment shader driven by the shared
 * AnalyserNode, on a hand-rolled WebGL1 canvas via twgl.js (MIT, ~22KB). Default-
 * exported so the host can lazy-load it (keeps twgl out of the main bundle until a
 * scene style is selected). `paused` freezes to a single static frame (off-screen
 * / reduced-motion). Self-authored shaders — MIT (MUZERO).
 */
type GLState = {
  gl: WebGLRenderingContext;
  programInfo: twgl.ProgramInfo;
  bufferInfo: twgl.BufferInfo;
  data: Uint8Array;
  start: number;
};

export default function ReactiveScene({
  styleId,
  active,
  paused,
  fftSize,
  options,
  smoothing,
  flow,
}: {
  styleId: string;
  active: boolean;
  paused: boolean;
  fftSize: number;
  options: VisualizerRenderOptions;
  smoothing: number;
  /** Flow background config (only used by scene-flow). */
  flow?: FlowConfig;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GLState | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  // Read live in the render loop so flow-setting changes don't restart the GL loop.
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const isFlow = styleId === "scene-flow";
  // Each flow effect is its own shader — selecting one rebuilds the GL program.
  const flowEffect = isFlow && flow ? flow.effect : DEFAULT_FLOW_EFFECT;
  const frag =
    styleId === "scene-aurora" ? AURORA_FRAG : isFlow ? FLOW_FRAGS[flowEffect] : LIQUID_FRAG;

  // Build the GL program/buffers once per shader (+ analyser bin count).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      powerPreference: "low-power",
    });
    if (!gl) return;

    const build = (): GLState | null => {
      if (gl.isContextLost()) return null;
      try {
        const programInfo = twgl.createProgramInfo(gl, [SCENE_VERT, frag]);
        if (!programInfo?.program) return null;
        const bufferInfo = twgl.primitives.createXYQuadBufferInfo(gl);
        return {
          gl,
          programInfo,
          bufferInfo,
          data: new Uint8Array(Math.floor(fftSize / 2)),
          start: 0,
        };
      } catch {
        // Shader/program failure → no scene (canvas stays transparent, the
        // stage's cover/title shows through) instead of crashing the React tree.
        return null;
      }
    };

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    stateRef.current = build();

    // WebGL contexts can be lost under memory pressure (esp. mobile WebViews).
    const onLost = (e: Event) => {
      e.preventDefault();
      stateRef.current = null;
    };
    const onRestored = () => {
      stateRef.current = build();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      // Do NOT loseContext() here: React StrictMode double-invokes effects
      // (mount→cleanup→mount) reusing the SAME canvas, and a context killed via
      // loseContext can't be recovered through getContext — the re-mount would
      // build its program on a dead context (link fails → crash). The context is
      // released by GC when the canvas element unmounts.
      stateRef.current = null;
    };
  }, [frag, fftSize]);

  // Run the render loop, or paint a single frozen frame when paused.
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // Reused per-frame so the flow palette upload doesn't churn the GC.
    const flowColors = new Float32Array(FLOW_MAX_COLORS * 3);

    const renderFrame = (tMs: number) => {
      const s = stateRef.current;
      if (!s) return;
      const { gl, programInfo, bufferInfo } = s;
      if (!s.start) s.start = tMs;

      twgl.resizeCanvasToDisplaySize(gl.canvas as HTMLCanvasElement, dpr);
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      let bass = 0;
      let mid = 0;
      let treble = 0;
      let energy = 0;
      const an = getMediaEngine()?.getAnalyser();
      if (an && an.fftSize !== fftSize) {
        an.fftSize = fftSize;
        an.smoothingTimeConstant = smoothing;
      }
      if (an && activeRef.current) {
        if (s.data.length !== an.frequencyBinCount) s.data = new Uint8Array(an.frequencyBinCount);
        an.getByteFrequencyData(s.data as Uint8Array<ArrayBuffer>);
        const a = computeAudioUniforms(
          s.data,
          an.frequencyBinCount,
          an.context.sampleRate,
          an.fftSize,
        );
        bass = a.bass;
        mid = a.mid;
        treble = a.treble;
        energy = a.energy;
      }
      const p = readPrimaryRgb(canvasRef.current);
      const flowCfg = isFlow ? flowRef.current : undefined;
      const flowCount = flowCfg ? fillFlowColors(flowColors, p, flowCfg) : 0;

      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
      gl.useProgram(programInfo.program);
      twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
      twgl.setUniforms(programInfo, {
        uTime: ((tMs - s.start) / 1000) * options.motion,
        uResolution: [gl.canvas.width, gl.canvas.height],
        uAudio: energy,
        uBass: bass,
        uMid: mid,
        uTreble: treble,
        uGlow: options.glow,
        uIntensity: options.intensity,
        uPrimary: [p.r / 255, p.g / 255, p.b / 255],
        uSpread: options.spread,
        // Flow-only uniforms (ignored by the other scene programs), sourced from
        // the resolved flow settings (color source + custom palette + tuning).
        ...(flowCfg
          ? {
              uColors: flowColors,
              uColorCount: flowCount,
              uFlowSpeed: flowCfg.speed,
              uFlowScale: flowCfg.scale,
              uReactivity: flowCfg.reactivity,
            }
          : null),
      });
      twgl.drawBufferInfo(gl, bufferInfo);
    };

    if (paused) {
      const id = requestAnimationFrame(renderFrame); // one static frame, then freeze
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const loop = (t: number) => {
      renderFrame(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, fftSize, smoothing, options, isFlow]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}

/**
 * Fill a flat vec3 buffer with the active flow palette and return the color
 * count. `resolveFlowColors` applies the cover→custom fallback rule; the
 * primary-derived spread is only a last-resort guard (custom colors are always
 * ≥ 2 via resolveFlowConfig).
 */
function fillFlowColors(out: Float32Array, primary: Rgb, flow: FlowConfig): number {
  const resolved = resolveFlowColors(flow.source, getVisualizerCoverPalette(), flow.customColors);
  const colors: Rgb[] =
    resolved.length >= 2 ? resolved : [darken(primary, 0.18), primary, lighten(primary, 0.4)];
  const count = Math.min(FLOW_MAX_COLORS, colors.length);
  for (let i = 0; i < FLOW_MAX_COLORS; i++) {
    const c = colors[Math.min(i, colors.length - 1)] ?? primary;
    out[i * 3] = c.r / 255;
    out[i * 3 + 1] = c.g / 255;
    out[i * 3 + 2] = c.b / 255;
  }
  return count;
}

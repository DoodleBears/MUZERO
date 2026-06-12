import { useEffect, useRef } from "react";
import * as twgl from "twgl.js";
import { type FlowConfig, resolveFlowColors } from "@/lib/flow-config";
import { darken, lighten, type Rgb, readPrimaryRgb } from "@/lib/visualizer-color";
import type { VisualizerRenderOptions } from "@/lib/visualizer-effect-settings";
import { getMediaEngine } from "@/stores/player-store";
import { getVisualizerCoverPalette } from "@/stores/visualizer-color-store";
import { computeAudioUniforms } from "./audio-uniforms";
import { DEFAULT_FLOW_EFFECT, FLOW_FRAGS } from "./flow-shaders";
import { SCENE_VERT } from "./scene-shaders";

/** Matches `#define FLOW_MAX_COLORS` in the flow shaders. */
const FLOW_MAX_COLORS = 5;

/**
 * Audio-reactive GPU scene — one full-screen fragment shader driven by the shared
 * AnalyserNode, on a hand-rolled WebGL1 canvas via twgl.js (MIT, ~22KB). Default-
 * exported so the host can lazy-load it (keeps twgl out of the main bundle until a
 * scene style is selected). `paused` freezes to a single static frame when the
 * surface is off-screen. Self-authored shaders — MIT (MUZERO).
 */
type GLState = {
  gl: WebGLRenderingContext;
  programInfo: twgl.ProgramInfo;
  bufferInfo: twgl.BufferInfo;
  data: Uint8Array;
  start: number;
};

/**
 * Release GPU-side program/shaders/buffers. GL resources are NOT freed by JS GC
 * while the context lives, so switching flow effects (each is its own shader)
 * would otherwise accumulate compiled programs until the canvas unmounts
 * (memory-perf-audit PRD F-5). Unlike `loseContext`, deleting a program leaves
 * the context reusable — safe under StrictMode's remount on the same canvas.
 */
export function releaseGlState(
  state: {
    gl: Pick<WebGLRenderingContext, "isContextLost" | "deleteProgram" | "deleteBuffer">;
    programInfo: { program: WebGLProgram };
    bufferInfo: Pick<twgl.BufferInfo, "attribs" | "indices">;
  } | null,
): void {
  if (!state) return;
  const { gl, programInfo, bufferInfo } = state;
  // A lost context already dropped its resources; deleting handles would throw.
  if (gl.isContextLost()) return;
  gl.deleteProgram(programInfo.program);
  for (const attrib of Object.values(bufferInfo.attribs ?? {})) gl.deleteBuffer(attrib.buffer);
  if (bufferInfo.indices) gl.deleteBuffer(bufferInfo.indices);
}

export default function ReactiveScene({
  styleId,
  active,
  paused,
  fftSize,
  options,
  smoothing,
  flow,
  placement = "surface",
}: {
  styleId: string;
  active: boolean;
  paused: boolean;
  fftSize: number;
  options: VisualizerRenderOptions;
  smoothing: number;
  /** Flow background config (only used by scene-flow). */
  flow?: FlowConfig;
  /** Background scenes (e.g. the full-screen flow) render at lower cost. */
  placement?: "surface" | "background";
}) {
  // A full-screen background scene doesn't need crisp DPR or 60fps — cap both to
  // cut GPU work (esp. the heavy fbm flow effects) without a visible change.
  const lowPower = placement === "background";
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
  const frag = FLOW_FRAGS[flowEffect];

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
      // released by GC when the canvas element unmounts. The program/buffers ARE
      // deleted though — they live on the GPU until then and would pile up per
      // shader switch (F-5).
      releaseGlState(stateRef.current);
      stateRef.current = null;
    };
  }, [frag, fftSize]);

  // Run the render loop, or paint a single frozen frame when paused.
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2);
    // Cap background scenes to ~40fps (0 = uncapped for surface visualizers).
    const minFrameMs = lowPower ? 1000 / 40 : 0;
    // Reused per-frame so the flow palette upload doesn't churn the GC.
    const flowColors = new Float32Array(FLOW_MAX_COLORS * 3);
    // getComputedStyle every frame forces a per-frame style read (F-9) — refresh
    // the accent on the same ~6-frame cadence the spectrum renderers use.
    let frame = 0;
    let primary = readPrimaryRgb(canvasRef.current);

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
      if (frame++ % 6 === 0) primary = readPrimaryRgb(canvasRef.current);
      const p = primary;
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
        uGlow: 1,
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
    let lastRender = 0;
    const loop = (t: number) => {
      if (t - lastRender >= minFrameMs) {
        renderFrame(t);
        lastRender = t;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paused, fftSize, smoothing, options, isFlow, lowPower]);

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

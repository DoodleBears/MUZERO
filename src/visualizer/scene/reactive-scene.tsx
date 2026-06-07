import { useEffect, useRef } from "react";
import * as twgl from "twgl.js";
import { readPrimaryRgb } from "@/lib/visualizer-color";
import { getMediaEngine } from "@/stores/player-store";
import { computeAudioUniforms } from "./audio-uniforms";
import { AURORA_FRAG, LIQUID_FRAG, SCENE_VERT } from "./scene-shaders";

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
  smoothing,
}: {
  styleId: string;
  active: boolean;
  paused: boolean;
  fftSize: number;
  smoothing: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<GLState | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const frag = styleId === "scene-aurora" ? AURORA_FRAG : LIQUID_FRAG;

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

    const build = (): GLState => {
      const programInfo = twgl.createProgramInfo(gl, [SCENE_VERT, frag]);
      const bufferInfo = twgl.primitives.createXYQuadBufferInfo(gl);
      return {
        gl,
        programInfo,
        bufferInfo,
        data: new Uint8Array(Math.floor(fftSize / 2)),
        start: 0,
      };
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
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      stateRef.current = null;
    };
  }, [frag, fftSize]);

  // Run the render loop, or paint a single frozen frame when paused.
  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

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
      const p = readPrimaryRgb();

      // biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL call, not a React hook
      gl.useProgram(programInfo.program);
      twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
      twgl.setUniforms(programInfo, {
        uTime: (tMs - s.start) / 1000,
        uResolution: [gl.canvas.width, gl.canvas.height],
        uAudio: energy,
        uBass: bass,
        uMid: mid,
        uTreble: treble,
        uPrimary: [p.r / 255, p.g / 255, p.b / 255],
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
  }, [paused, fftSize, smoothing]);

  return <canvas ref={canvasRef} className="block h-full w-full" />;
}

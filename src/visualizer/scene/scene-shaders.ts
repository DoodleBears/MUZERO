/**
 * GLSL for the audio-reactive scene backgrounds. Inlined as template strings
 * (same pattern as dither-background.tsx) to avoid a `?raw` import + ambient type
 * declaration. Unified uniform prelude across scenes:
 *   uTime, uResolution, uAudio (overall energy), uBass, uMid, uTreble, uPrimary.
 * Self-authored — MIT (MUZERO).
 */

/** Full-screen pass for twgl's createXYQuadBufferInfo (position + texcoord attrs). */
export const SCENE_VERT = /* glsl */ `
attribute vec2 position;
attribute vec2 texcoord;
varying vec2 vUv;
void main() {
  vUv = texcoord;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;


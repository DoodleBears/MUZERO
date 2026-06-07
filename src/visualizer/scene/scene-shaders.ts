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

const NOISE = /* glsl */ `
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; }
  return v;
}
`;

/** Liquid — flowing domain-warped fbm, swelling with bass + overall energy. */
export const LIQUID_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform float uAudio;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform vec3 uPrimary;
${NOISE}
void main() {
  vec2 uv = vUv;
  float t = uTime * 0.08 + uBass * 1.5;
  vec2 q = uv * 3.0;
  q += vec2(fbm(q + t), fbm(q - t)) * (0.6 + uBass * 1.2);
  float n = fbm(q + uTime * 0.05);
  float glow = smoothstep(0.2, 0.9, n) * (0.5 + uAudio * 0.9) + uTreble * 0.2;
  vec3 col = mix(uPrimary * 0.06, uPrimary, clamp(glow, 0.0, 1.0));
  float alpha = clamp(glow * 0.9 + 0.12, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/** Aurora — drifting vertical curtains, brighter toward the top, mid-driven width. */
export const AURORA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform float uAudio;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform vec3 uPrimary;
${NOISE}
void main() {
  vec2 uv = vUv;
  float t = uTime * 0.2;
  float band = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x + 0.12 * sin(uv.y * 3.0 + t + fi * 2.0) + noise(vec2(uv.y * 2.0, t * 0.5 + fi)) * 0.1;
    float center = 0.3 + 0.2 * fi + 0.05 * sin(t + fi);
    float w = 0.06 + uMid * 0.06;
    band += smoothstep(w, 0.0, abs(x - center));
  }
  float vert = smoothstep(0.0, 0.6, uv.y);
  float intensity = band * vert * (0.4 + uAudio * 1.1) + uTreble * 0.1;
  vec3 col = uPrimary * intensity;
  float alpha = clamp(intensity * 0.85 + 0.1, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

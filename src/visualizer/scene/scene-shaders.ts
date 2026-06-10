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
uniform float uGlow;
uniform float uIntensity;
uniform float uSpread;
uniform vec3 uPrimary;
${NOISE}
void main() {
  vec2 uv = vUv;
  float t = uTime * 0.08 + uBass * uIntensity * 1.5;
  vec2 q = uv * (3.0 / max(0.35, uSpread));
  q += vec2(fbm(q + t), fbm(q - t)) * (0.6 + uBass * uIntensity * 1.2);
  float n = fbm(q + uTime * 0.05);
  float glow = smoothstep(0.2, 0.9, n) * (0.5 + uAudio * uIntensity * 0.9) + uTreble * uIntensity * 0.2;
  glow *= uGlow;
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
uniform float uGlow;
uniform float uIntensity;
uniform float uSpread;
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
    float w = (0.06 + uMid * uIntensity * 0.06) * uSpread;
    band += smoothstep(w, 0.0, abs(x - center));
  }
  float vert = smoothstep(0.0, 0.6, uv.y);
  float intensity = (band * vert * (0.4 + uAudio * uIntensity * 1.1) + uTreble * uIntensity * 0.1) * uGlow;
  vec3 col = uPrimary * intensity;
  float alpha = clamp(intensity * 0.85 + 0.1, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

/**
 * Flow — calm multi-color "流光" mesh gradient. N color blobs drift on slow
 * Lissajous paths and blend by soft Gaussian weights, so the colors melt into
 * one another like an aurora wallpaper. Audio is an optional *subtle* modulation
 * (uReactivity), not a spectrum — this is ambient, not a dancefloor.
 * uEffect picks the motion character: 0 aurora-drift, 1 liquid-mesh, 2 soft-blobs.
 * Self-authored — MIT (MUZERO).
 */
export const FLOW_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uResolution;
uniform float uAudio;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uGlow;
uniform float uIntensity;
uniform float uSpread;
uniform vec3 uPrimary;
#define FLOW_MAX_COLORS 5
uniform vec3 uColors[FLOW_MAX_COLORS];
uniform int uColorCount;
uniform float uFlowSpeed;
uniform float uFlowScale;
uniform float uReactivity;
uniform int uEffect;
void main() {
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vUv;
  p.x *= aspect;

  float t = uTime * (0.04 + uFlowSpeed * 0.22);
  // blob radius scale, plus a gentle bass-driven swell
  float pump = 1.0 + uBass * uReactivity * 0.8;
  float baseR = mix(0.45, 1.05, uFlowScale) * pump;

  vec3 col = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++) {
    if (i >= uColorCount) break;
    float fi = float(i);
    // each color drifts on its own slow path; effects vary the character
    vec2 c = vec2(
      0.5 * aspect + 0.34 * aspect * sin(t * (0.7 + 0.13 * fi) + fi * 1.7),
      0.5 + 0.34 * cos(t * (0.6 + 0.11 * fi) + fi * 2.3)
    );
    float radius = baseR * (0.85 + 0.15 * sin(t + fi));
    if (uEffect == 0) {            // aurora-drift: taller vertical sway
      c.y += 0.14 * sin(t * 1.2 + fi);
    } else if (uEffect == 1) {     // liquid-mesh: swirl + wider overlap
      c += 0.12 * vec2(sin(t * 1.3 + fi), cos(t * 1.1 + fi));
      radius *= 1.25;
    } else {                        // soft-blobs: tighter, slower, more separated
      radius *= 0.8;
    }
    float d = distance(p, c);
    float w = exp(-(d * d) / max(0.02, radius * radius) * 2.0);
    col += uColors[i] * w;
    wsum += w;
  }
  col = wsum > 0.0 ? col / wsum : uPrimary;

  float bright = (0.82 + uAudio * uReactivity * 0.6) * clamp(uGlow, 0.2, 1.6);
  col *= bright;
  float alpha = clamp(0.74 + wsum * 0.2, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

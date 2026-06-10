import type { FlowEffectId } from "@/db/types";

/**
 * Flow background fragment shaders — one per effect, self-authored to cover the
 * full `color4bg` style family WITHOUT the dependency (no color4bg / ogl). Each
 * shares FLOW_PRELUDE (uniforms + noise/fbm + a multi-color `ramp()`), so the
 * cover/custom palette drives every effect. WebGL1 / GLSL ES 1.0 (twgl), paired
 * with SCENE_VERT in reactive-scene. The 3D/canvas color4bg styles (random-cubes,
 * abstract-shape) are 2D approximations of the original look. MIT (MUZERO).
 *
 * color4bg is NOT audio-reactive; MUZERO adds a *subtle* `uReactivity` modulation
 * so the flow can breathe with the music while staying an ambient backdrop.
 */

const FLOW_PRELUDE = /* glsl */ `
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

float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = p * 2.0 + 1.7; a *= 0.5; } return v; }

// Map t in [0,1] across uColors[0..count-1] (only loop-index array access — GLSL ES 1.0 safe).
vec3 ramp(float t){
  t = clamp(t, 0.0, 1.0) * float(uColorCount - 1);
  vec3 col = uColors[0];
  for (int i = 1; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    col = mix(col, uColors[i], clamp(t - float(i - 1), 0.0, 1.0));
  }
  return col;
}
float flowBright(){ return (0.82 + uAudio * uReactivity * 0.6) * clamp(uGlow, 0.2, 1.6); }
float flowTime(){ return uTime * (0.04 + uFlowSpeed * 0.22); }
`;

// --- Blob / metaball family (calm, ambient) --------------------------------

const AMBIENT_LIGHT = /* glsl */ `
void main(){
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vUv; p.x *= aspect;
  float t = flowTime();
  float pump = 1.0 + uBass * uReactivity * 0.8;
  float baseR = mix(0.45, 1.05, uFlowScale) * pump;
  vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    float fi = float(i);
    vec2 c = vec2(0.5 * aspect + 0.34 * aspect * sin(t * (0.7 + 0.13 * fi) + fi * 1.7),
                  0.5 + 0.34 * cos(t * (0.6 + 0.11 * fi) + fi * 2.3));
    c.y += 0.14 * sin(t * 1.2 + fi);
    float r = baseR * (0.85 + 0.15 * sin(t + fi));
    float d = distance(p, c);
    float w = exp(-(d * d) / max(0.02, r * r) * 2.0);
    col += uColors[i] * w; wsum += w;
  }
  col = wsum > 0.0 ? col / wsum : uPrimary;
  col *= flowBright();
  gl_FragColor = vec4(col, clamp(0.74 + wsum * 0.2, 0.0, 1.0));
}
`;

const AESTHETIC_FLUID = /* glsl */ `
void main(){
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vUv; p.x *= aspect;
  float t = flowTime();
  vec2 q = p + 0.12 * vec2(sin(t * 1.3 + p.y * 3.0), cos(t * 1.1 + p.x * 3.0));
  float pump = 1.0 + uBass * uReactivity * 0.8;
  float baseR = mix(0.5, 1.2, uFlowScale) * pump * 1.25;
  vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    float fi = float(i);
    vec2 c = vec2(0.5 * aspect + 0.3 * aspect * sin(t * (0.6 + 0.1 * fi) + fi * 2.0),
                  0.5 + 0.3 * cos(t * (0.5 + 0.09 * fi) + fi * 1.3));
    float r = baseR * (0.9 + 0.2 * sin(t * 0.7 + fi));
    float d = distance(q, c);
    float w = exp(-(d * d) / max(0.02, r * r) * 1.7);
    col += uColors[i] * w; wsum += w;
  }
  col = wsum > 0.0 ? col / wsum : uPrimary;
  col *= flowBright();
  gl_FragColor = vec4(col, clamp(0.76 + wsum * 0.18, 0.0, 1.0));
}
`;

const BIG_BLOB = /* glsl */ `
void main(){
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vUv; p.x *= aspect;
  float t = flowTime();
  float pump = 1.0 + uBass * uReactivity * 0.7;
  float field = 0.0; vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    float fi = float(i);
    vec2 c = vec2(0.5 * aspect + 0.28 * aspect * sin(t * (0.5 + 0.12 * fi) + fi * 2.4),
                  0.5 + 0.28 * cos(t * (0.45 + 0.1 * fi) + fi * 1.1));
    float r = mix(0.32, 0.6, uFlowScale) * pump;
    float d = distance(p, c);
    float m = (r * r) / max(0.0008, d * d);
    field += m; col += uColors[i] * m; wsum += m;
  }
  col = wsum > 0.0 ? col / wsum : uPrimary;
  float blob = smoothstep(0.8, 1.6, field);
  col = mix(uColors[0] * 0.22, col, blob) * flowBright();
  gl_FragColor = vec4(col, clamp(0.7 + blob * 0.3, 0.0, 1.0));
}
`;

const BLUR_DOT = /* glsl */ `
void main(){
  float aspect = uResolution.x / max(1.0, uResolution.y);
  vec2 p = vUv; p.x *= aspect;
  float t = uTime * (0.05 + uFlowSpeed * 0.2);
  vec3 col = vec3(0.0); float wsum = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    float fi = float(i);
    vec2 c = vec2(0.5 * aspect + 0.38 * aspect * cos((t + fi * 1.3) * (0.7 + 0.05 * fi)),
                  0.5 + 0.38 * sin((t + fi * 2.1) * (0.5 + 0.04 * fi)));
    float r = mix(0.28, 0.55, uFlowScale) * (1.0 + uBass * uReactivity * 0.5);
    float d = distance(p, c);
    float w = 1.0 - smoothstep(0.0, r, d);
    col += uColors[i] * w; wsum += w;
  }
  col = wsum > 0.0 ? col / wsum : uPrimary;
  col *= flowBright();
  gl_FragColor = vec4(col, clamp(0.7 + wsum * 0.22, 0.0, 1.0));
}
`;

// --- Gradient / band family ------------------------------------------------

const BLUR_GRADIENT = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float t = flowTime();
  float ang = (vnoise(vec2(t * 0.3, uv.y * 1.5)) - 0.5) * 1.4;
  float ca = cos(ang), sa = sin(ang);
  vec2 ruv = vec2(uv.x * ca - uv.y * sa, uv.x * sa + uv.y * ca);
  float g = ruv.y + 0.12 * sin(ruv.x * (4.0 + uFlowScale * 6.0) + t * 2.0);
  float v = 0.5 + 0.5 * sin(g * 3.14159 * 1.4 + t);
  vec3 col = ramp(v) * flowBright();
  gl_FragColor = vec4(col, 0.88);
}
`;

const STEP_GRADIENT = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  float cells = mix(8.0, 20.0, uFlowScale);
  vec2 g = uv * cells;
  vec2 f = fract(g) - 0.5;
  float box = 1.0 - smoothstep(0.3, 0.45, length(max(abs(f) - 0.2, 0.0)));
  float ripple = 0.5 + 0.5 * cos(t * 2.0 + distance(uv, vec2(0.5 * aspect, 0.5)) * 10.0);
  float ripple2 = 0.5 + 0.5 * cos(t * 1.5 + distance(uv, vec2(0.2, 0.8)) * 8.0);
  float v = clamp((ripple + ripple2) * 0.5, 0.0, 1.0);
  vec3 col = ramp(v) * box * flowBright();
  gl_FragColor = vec4(col, clamp(box * (0.4 + v * 0.6), 0.0, 1.0));
}
`;

const CURVE_GRADIENT = /* glsl */ `
void main(){
  vec2 s = (vUv - 0.5) * (2.0 + uFlowScale * 2.0);
  float d = -flowTime() * 2.0; float a = 0.0;
  for (int i = 0; i < 8; i++){ float fi = float(i); a -= cos(fi + d - a * s.x); d += sin(s.y * fi + a); }
  float v = 0.5 + 0.5 * cos(d + a);
  vec3 col = ramp(v) * flowBright();
  gl_FragColor = vec4(col, 0.9);
}
`;

// --- Wave / flow-field family ----------------------------------------------

const WAVY_WAVES = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  vec2 p = uv * (2.5 + uFlowScale * 2.0);
  for (int i = 0; i < 7; i++){
    vec2 g = vec2(cos(p.x + sin(p.y + t)), cos(p.y + t));
    vec2 tang = vec2(-g.y, g.x);
    p += 0.06 * tang + 0.02 * g;
  }
  float v = 0.5 + 0.5 * sin(p.x + p.y);
  vec3 col = ramp(v) * flowBright();
  gl_FragColor = vec4(col, 0.9);
}
`;

const CHAOS_WAVES = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  vec2 q = uv * (2.0 + uFlowScale * 3.0);
  float f = fbm(q + fbm(q + fbm(q + vec2(t))));
  vec3 col = ramp(f) * flowBright() * (0.9 + uTreble * uReactivity * 0.3);
  gl_FragColor = vec4(col, 0.92);
}
`;

const SWIRLING_CURVES = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  vec2 q = uv * (1.5 + uFlowScale * 2.0);
  vec2 o = vec2(fbm(q + vec2(0.0, t)), fbm(q + vec2(5.2, 1.3 - t)));
  vec2 r = vec2(fbm(q + 4.0 * o + vec2(1.7, 9.2)), fbm(q + 4.0 * o + vec2(8.3, 2.8)));
  float f = fbm(q + 4.0 * r);
  vec3 col = ramp(f) * flowBright() * (0.9 + uMid * uReactivity * 0.3);
  gl_FragColor = vec4(col, 0.92);
}
`;

// --- Geometric / tiling family (2D approximations of the color4bg looks) ----

const GRID_ARRAY = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  float cells = mix(6.0, 18.0, uFlowScale);
  vec2 g = uv * cells;
  vec2 id = floor(g); vec2 f = fract(g) - 0.5;
  float box = 1.0 - smoothstep(0.34, 0.46, length(max(abs(f) - 0.18, 0.0)));
  float rnd = hash21(id);
  float pulse = 0.5 + 0.5 * cos(t * 2.0 + rnd * 6.28 + (id.x + id.y) * 0.4);
  vec3 col = ramp(rnd) * box * (0.4 + pulse * 0.6) * flowBright();
  gl_FragColor = vec4(col, clamp(box * (0.5 + pulse * 0.5), 0.0, 1.0));
}
`;

const TRIANGLES_MOSAIC = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  float cells = mix(6.0, 16.0, uFlowScale);
  vec2 g = uv * cells;
  vec2 sk = vec2(g.x + g.y * 0.5, g.y);
  vec2 id = floor(sk); vec2 f = fract(sk);
  float upper = step(1.0, f.x + f.y);
  float rnd = hash21(id + upper * 37.0);
  float phase = 0.5 + 0.5 * sin(t * 1.5 + rnd * 6.28);
  vec3 col = ramp(phase) * flowBright();
  float edge = smoothstep(0.0, 0.04, min(min(f.x, f.y), abs(f.x + f.y - 1.0)));
  col *= (0.82 + 0.18 * edge);
  gl_FragColor = vec4(col, 0.92);
}
`;

const RANDOM_CUBES = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime();
  vec3 col = uColors[0] * 0.14; float cov = 0.0;
  for (int i = 0; i < FLOW_MAX_COLORS; i++){
    if (i >= uColorCount) break;
    float fi = float(i);
    float depth = 0.4 + 0.6 * hash21(vec2(fi, 1.0));
    vec2 c = vec2(0.5 * aspect + 0.4 * aspect * sin(t * depth + fi * 2.0),
                  0.5 + 0.4 * cos(t * depth * 0.8 + fi * 1.5));
    vec2 q = uv - c;
    float ang = t * depth + fi; float ca = cos(ang), sa = sin(ang);
    q = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
    float sz = mix(0.08, 0.18, uFlowScale) * depth;
    float sq = 1.0 - smoothstep(sz * 0.8, sz, max(abs(q.x), abs(q.y)));
    col = mix(col, uColors[i] * depth, sq * depth);
    cov = max(cov, sq * depth);
  }
  col *= flowBright();
  gl_FragColor = vec4(col, clamp(0.55 + cov * 0.4, 0.0, 1.0));
}
`;

const ABSTRACT_SHAPE = /* glsl */ `
void main(){
  vec2 uv = vUv;
  float aspect = uResolution.x / max(1.0, uResolution.y); uv.x *= aspect;
  float t = flowTime() * 0.6;
  vec2 q = uv * (3.0 + uFlowScale * 3.0) + vec2(fbm(uv * 2.0 + t), fbm(uv * 2.0 - t));
  vec2 gi = floor(q); vec2 gf = fract(q);
  float md = 8.0; vec2 mc = vec2(0.0);
  for (int y = -1; y <= 1; y++){
    for (int x = -1; x <= 1; x++){
      vec2 o = vec2(float(x), float(y));
      vec2 r = o + vec2(hash21(gi + o), hash21(gi + o + 11.0)) - gf;
      float d = dot(r, r);
      if (d < md){ md = d; mc = gi + o; }
    }
  }
  float rnd = hash21(mc);
  float cell = sqrt(md);
  vec3 col = ramp(rnd) * (0.6 + 0.4 * (1.0 - cell)) * flowBright();
  gl_FragColor = vec4(col, 0.92);
}
`;

/** All flow effect fragment shaders, keyed by effect id (TS enforces completeness). */
export const FLOW_FRAGS: Record<FlowEffectId, string> = {
  "ambient-light": FLOW_PRELUDE + AMBIENT_LIGHT,
  "aesthetic-fluid": FLOW_PRELUDE + AESTHETIC_FLUID,
  "big-blob": FLOW_PRELUDE + BIG_BLOB,
  "blur-dot": FLOW_PRELUDE + BLUR_DOT,
  "blur-gradient": FLOW_PRELUDE + BLUR_GRADIENT,
  "wavy-waves": FLOW_PRELUDE + WAVY_WAVES,
  "chaos-waves": FLOW_PRELUDE + CHAOS_WAVES,
  "swirling-curves": FLOW_PRELUDE + SWIRLING_CURVES,
  "curve-gradient": FLOW_PRELUDE + CURVE_GRADIENT,
  "step-gradient": FLOW_PRELUDE + STEP_GRADIENT,
  "grid-array": FLOW_PRELUDE + GRID_ARRAY,
  "triangles-mosaic": FLOW_PRELUDE + TRIANGLES_MOSAIC,
  "random-cubes": FLOW_PRELUDE + RANDOM_CUBES,
  "abstract-shape": FLOW_PRELUDE + ABSTRACT_SHAPE,
};

/** Fallback shader when a stored effect id is unknown. */
export const DEFAULT_FLOW_EFFECT: FlowEffectId = "ambient-light";

/**
 * Pure FFT-binning math shared by the spectrum renderers. Linear FFT bins look
 * bad for music (all the musical energy crams into the low end); grouping bins
 * into logarithmic octave-fraction bands gives even visual weight per octave —
 * the standard approach (audioMotion / Daniel Beer), reimplemented clean-room.
 */

/** An inclusive FFT bin range [lo, hi] that forms one visual band. */
export interface Band {
  lo: number;
  hi: number;
}

/**
 * Group linear FFT bins into logarithmic bands spanning [fMin, fMax] (clamped to
 * Nyquist). Low-frequency octave slices that map to the same single bin are
 * collapsed so bands never overlap and are strictly increasing.
 */
export function octaveBands(opts: {
  fftSize: number;
  sampleRate: number;
  bandsPerOctave?: number;
  fMin?: number;
  fMax?: number;
}): Band[] {
  const { fftSize, sampleRate, bandsPerOctave = 3, fMin = 30, fMax = 16000 } = opts;
  const binCount = Math.floor(fftSize / 2);
  if (binCount <= 0 || sampleRate <= 0) return [];
  const hzPerBin = sampleRate / fftSize;
  const top = Math.min(fMax, sampleRate / 2);
  if (top <= fMin) return [];

  const totalOctaves = Math.log2(top / fMin);
  const n = Math.max(1, Math.round(totalOctaves * bandsPerOctave));
  const bands: Band[] = [];
  let prevHi = -1;
  for (let i = 0; i < n; i++) {
    const f0 = fMin * 2 ** (i / bandsPerOctave);
    const f1 = fMin * 2 ** ((i + 1) / bandsPerOctave);
    let lo = Math.floor(f0 / hzPerBin);
    let hi = Math.ceil(f1 / hzPerBin) - 1;
    lo = Math.max(0, Math.min(binCount - 1, lo));
    hi = Math.max(0, Math.min(binCount - 1, hi));
    if (lo <= prevHi) lo = prevHi + 1;
    if (lo > hi || lo > binCount - 1) continue;
    bands.push({ lo, hi });
    prevHi = hi;
  }
  return bands;
}

/**
 * Reduce FFT byte data (0..255) to a 0..1 level per band, taking the *max* bin in
 * each band so transient peaks survive (averaging washes them out).
 */
export function aggregateBands(data: Uint8Array | number[], bands: Band[]): number[] {
  return aggregateBandsInto(new Array(bands.length), data, bands);
}

/** {@link aggregateBands} writing into a reused array — for the 60fps render
 *  loops, which otherwise allocate several short-lived arrays per frame (F-10). */
export function aggregateBandsInto(
  out: number[],
  data: Uint8Array | number[],
  bands: Band[],
): number[] {
  out.length = bands.length;
  for (let b = 0; b < bands.length; b++) {
    const { lo, hi } = bands[b];
    let max = 0;
    for (let i = lo; i <= hi; i++) {
      const v = data[i] ?? 0;
      if (v > max) max = v;
    }
    out[b] = max / 255;
  }
  return out;
}

/**
 * Perceptual tilt multipliers: gently lift higher bands so bass doesn't visually
 * dominate. Index 0 → 1, last index → 1 + strength, linear in between.
 */
export function tiltWeights(n: number, strength = 0.6): number[] {
  if (n <= 1) return n === 1 ? [1] : [];
  return Array.from({ length: n }, (_, i) => 1 + strength * (i / (n - 1)));
}

/** Apply tilt weights to band levels, clamped to 1. */
export function applyTilt(levels: number[], weights: number[]): number[] {
  return levels.map((v, i) => Math.min(1, v * (weights[i] ?? 1)));
}

/** {@link applyTilt} mutating `levels` in place (F-10). */
export function applyTiltInto(levels: number[], weights: number[]): number[] {
  for (let i = 0; i < levels.length; i++) {
    levels[i] = Math.min(1, levels[i] * (weights[i] ?? 1));
  }
  return levels;
}

/**
 * Exponential moving average toward `next` (alpha 1 = no smoothing, 0 = frozen).
 * Missing prev entries are treated as 0. Returns a new array.
 */
export function smoothBands(prev: number[], next: number[], alpha = 0.5): number[] {
  return next.map((v, i) => {
    const p = prev[i] ?? 0;
    return p + (v - p) * alpha;
  });
}

/** {@link smoothBands} writing into `prev` (resized to match `next`; F-10). */
export function smoothBandsInto(prev: number[], next: number[], alpha = 0.5): number[] {
  const n = next.length;
  for (let i = 0; i < n; i++) {
    const p = prev[i] ?? 0;
    prev[i] = p + (next[i] - p) * alpha;
  }
  prev.length = n;
  return prev;
}

/**
 * Per-frame factor for sinking levels back to rest when nothing is playing —
 * small, so a paused track's bars fall gently (~1s settle at 60fps) instead of
 * snapping to the floor, and a silent player rests flat instead of faking
 * idle motion.
 */
export const REST_DECAY = 0.08;

/**
 * Below this magnitude a decaying level is visually indistinguishable from rest,
 * so we snap it to a true 0 — exponential decay otherwise has an infinite tail
 * that lingers at imperceptible values and keeps the render loop busy forever.
 */
export const REST_EPSILON = 1e-3;

/**
 * Ease a single value toward zero by `alpha`, snapping the imperceptible tail to
 * a true rest. `Math.abs` so it works for unsigned band levels and signed
 * waveform samples alike.
 */
export function decayLevel(v: number, alpha = REST_DECAY): number {
  const next = v * (1 - alpha);
  return Math.abs(next) < REST_EPSILON ? 0 : next;
}

/**
 * Ease band levels toward zero (the "no audio" rest state). Equivalent to
 * `smoothBands(levels, zeros, alpha)` but without allocating a target array, and
 * settles to an exact 0 (see `decayLevel`).
 */
export function decayBands(levels: number[], alpha = REST_DECAY): number[] {
  return levels.map((v) => decayLevel(v, alpha));
}

/** {@link decayBands} mutating `levels` in place (F-10). */
export function decayBandsInto(levels: number[], alpha = REST_DECAY): number[] {
  for (let i = 0; i < levels.length; i++) levels[i] = decayLevel(levels[i], alpha);
  return levels;
}

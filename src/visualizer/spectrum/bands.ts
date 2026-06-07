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
  return bands.map(({ lo, hi }) => {
    let max = 0;
    for (let i = lo; i <= hi; i++) {
      const v = data[i] ?? 0;
      if (v > max) max = v;
    }
    return max / 255;
  });
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

/**
 * Reduce the FFT spectrum into a handful of scalars (bass / mid / treble /
 * overall energy, each 0..1) to drive shader uniforms. Pure so it's unit-tested
 * independently of WebGL.
 */
export interface AudioUniforms {
  bass: number;
  mid: number;
  treble: number;
  energy: number;
}

export const SILENT: AudioUniforms = { bass: 0, mid: 0, treble: 0, energy: 0 };

export function computeAudioUniforms(
  data: Uint8Array | number[],
  binCount: number,
  sampleRate: number,
  fftSize: number,
): AudioUniforms {
  if (binCount <= 0 || sampleRate <= 0 || fftSize <= 0) return SILENT;
  const hzPerBin = sampleRate / fftSize;

  const bandAvg = (loHz: number, hiHz: number) => {
    const lo = Math.max(0, Math.floor(loHz / hzPerBin));
    const hi = Math.min(binCount - 1, Math.ceil(hiHz / hzPerBin));
    let sum = 0;
    let n = 0;
    for (let i = lo; i <= hi; i++) {
      sum += data[i] ?? 0;
      n++;
    }
    return n > 0 ? sum / n / 255 : 0;
  };

  let total = 0;
  for (let i = 0; i < binCount; i++) total += data[i] ?? 0;

  return {
    bass: bandAvg(20, 250),
    mid: bandAvg(250, 2000),
    treble: bandAvg(2000, 12000),
    energy: total / binCount / 255,
  };
}

/**
 * Minimal pure PCM→WAV encoder + a deterministic tone synthesizer.
 *
 * Used by the mock music-gen provider so the app can play real audio in dev
 * without a model, and by unit tests (pure, no DOM/audio APIs). Output is a
 * standard 16-bit PCM mono WAV the WebView `<audio>` element can decode.
 */

export interface PcmClip {
  sampleRate: number;
  /** Mono samples in [-1, 1]. */
  samples: Float32Array;
}

/** Encode a mono Float32 PCM clip as a 16-bit WAV byte buffer. */
export function encodeWav(clip: PcmClip): Uint8Array {
  const { sampleRate, samples } = clip;
  const numFrames = samples.length;
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = numFrames * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Deterministic placeholder tone. Picks a base frequency from a hash of `seed`
 * so different briefs sound different, and fades in/out to avoid clicks. Kept
 * short (default 2s) regardless of the requested duration — it's a stand-in.
 */
export function synthTone(seed: string, seconds = 2, sampleRate = 22050): PcmClip {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const baseFreq = 196 + (Math.abs(hash) % 12) * 24; // ~G3..G5 across the scale
  const numFrames = Math.max(1, Math.floor(seconds * sampleRate));
  const samples = new Float32Array(numFrames);
  const fade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRate;
    // Base + a fifth above for a fuller, less sterile tone.
    let v = 0.5 * Math.sin(2 * Math.PI * baseFreq * t);
    v += 0.25 * Math.sin(2 * Math.PI * baseFreq * 1.5 * t);
    let gain = 1;
    if (i < fade) gain = i / fade;
    else if (i > numFrames - fade) gain = (numFrames - i) / fade;
    samples[i] = v * gain * 0.8;
  }
  return { sampleRate, samples };
}

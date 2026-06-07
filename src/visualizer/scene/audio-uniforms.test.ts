import { describe, expect, it } from "vitest";
import { computeAudioUniforms, SILENT } from "./audio-uniforms";

const BIN = 512;
const SR = 44100;
const FFT = 1024;

describe("computeAudioUniforms", () => {
  it("maps a full spectrum to all-1", () => {
    const data = new Uint8Array(BIN).fill(255);
    const u = computeAudioUniforms(data, BIN, SR, FFT);
    expect(u.bass).toBeCloseTo(1, 5);
    expect(u.mid).toBeCloseTo(1, 5);
    expect(u.treble).toBeCloseTo(1, 5);
    expect(u.energy).toBeCloseTo(1, 5);
  });

  it("maps silence to all-0", () => {
    const u = computeAudioUniforms(new Uint8Array(BIN), BIN, SR, FFT);
    expect(u).toEqual({ bass: 0, mid: 0, treble: 0, energy: 0 });
  });

  it("isolates bass when only low bins are hot", () => {
    const data = new Uint8Array(BIN);
    // ~20-250Hz with hzPerBin≈43 → bins ~0-5
    for (let i = 0; i <= 5; i++) data[i] = 255;
    const u = computeAudioUniforms(data, BIN, SR, FFT);
    expect(u.bass).toBeGreaterThan(0.5);
    expect(u.treble).toBe(0);
  });

  it("isolates treble when only high bins are hot", () => {
    const data = new Uint8Array(BIN);
    for (let i = 60; i < BIN; i++) data[i] = 255; // well above 2kHz
    const u = computeAudioUniforms(data, BIN, SR, FFT);
    expect(u.treble).toBeGreaterThan(0.5);
    expect(u.bass).toBe(0);
  });

  it("returns SILENT for degenerate inputs", () => {
    expect(computeAudioUniforms([], 0, SR, FFT)).toEqual(SILENT);
    expect(computeAudioUniforms(new Uint8Array(BIN), BIN, 0, FFT)).toEqual(SILENT);
  });

  it("keeps every value in [0,1]", () => {
    const data = new Uint8Array(BIN);
    for (let i = 0; i < BIN; i++) data[i] = (i * 13) % 256;
    const u = computeAudioUniforms(data, BIN, SR, FFT);
    for (const v of [u.bass, u.mid, u.treble, u.energy]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

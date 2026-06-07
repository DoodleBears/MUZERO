import { describe, expect, it } from "vitest";
import {
  aggregateBands,
  applyTilt,
  type Band,
  octaveBands,
  smoothBands,
  tiltWeights,
} from "./bands";

describe("octaveBands", () => {
  const opts = { fftSize: 2048, sampleRate: 44100, bandsPerOctave: 3 };

  it("produces non-empty, strictly increasing, non-overlapping bands", () => {
    const bands = octaveBands(opts);
    expect(bands.length).toBeGreaterThan(0);
    for (let i = 0; i < bands.length; i++) {
      expect(bands[i].lo).toBeLessThanOrEqual(bands[i].hi);
      if (i > 0) expect(bands[i].lo).toBeGreaterThan(bands[i - 1].hi); // no overlap
    }
  });

  it("keeps every bin within [0, fftSize/2 - 1]", () => {
    const bands = octaveBands(opts);
    const binCount = opts.fftSize / 2;
    for (const b of bands) {
      expect(b.lo).toBeGreaterThanOrEqual(0);
      expect(b.hi).toBeLessThanOrEqual(binCount - 1);
    }
  });

  it("makes more bands at higher resolution", () => {
    const coarse = octaveBands({ ...opts, bandsPerOctave: 1 });
    const fine = octaveBands({ ...opts, bandsPerOctave: 6 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it("clamps the top frequency to Nyquist", () => {
    const bands = octaveBands({ fftSize: 2048, sampleRate: 8000, fMax: 16000 });
    const binCount = 1024;
    for (const b of bands) expect(b.hi).toBeLessThanOrEqual(binCount - 1);
  });

  it("returns [] when the range is empty", () => {
    expect(octaveBands({ fftSize: 2048, sampleRate: 44100, fMin: 16000, fMax: 30 })).toEqual([]);
  });
});

describe("aggregateBands", () => {
  const bands: Band[] = [
    { lo: 0, hi: 1 },
    { lo: 2, hi: 3 },
  ];
  it("maps all-max data to 1.0 per band", () => {
    expect(aggregateBands([255, 255, 255, 255], bands)).toEqual([1, 1]);
  });
  it("maps silence to 0", () => {
    expect(aggregateBands([0, 0, 0, 0], bands)).toEqual([0, 0]);
  });
  it("takes the max bin in each band", () => {
    // band0 max=128→~0.502, band1 max=255→1
    const out = aggregateBands([0, 128, 10, 255], bands);
    expect(out[0]).toBeCloseTo(128 / 255, 5);
    expect(out[1]).toBe(1);
  });
});

describe("tiltWeights / applyTilt", () => {
  it("ramps from 1 to 1+strength", () => {
    const w = tiltWeights(3, 0.6);
    expect(w[0]).toBe(1);
    expect(w[2]).toBeCloseTo(1.6, 5);
    expect(w[1]).toBeGreaterThan(w[0]);
  });
  it("handles degenerate lengths", () => {
    expect(tiltWeights(1)).toEqual([1]);
    expect(tiltWeights(0)).toEqual([]);
  });
  it("applies weights but clamps to 1", () => {
    expect(applyTilt([0.5, 0.8], [1, 2])).toEqual([0.5, 1]);
  });
});

describe("smoothBands (EMA)", () => {
  it("alpha 1 = no smoothing (equals next)", () => {
    expect(smoothBands([0, 0], [0.5, 0.9], 1)).toEqual([0.5, 0.9]);
  });
  it("alpha 0 = frozen (equals prev)", () => {
    expect(smoothBands([0.2, 0.4], [1, 1], 0)).toEqual([0.2, 0.4]);
  });
  it("blends halfway at alpha 0.5", () => {
    expect(smoothBands([0, 0], [1, 0.4], 0.5)).toEqual([0.5, 0.2]);
  });
  it("treats missing prev entries as 0", () => {
    expect(smoothBands([], [0.6], 0.5)).toEqual([0.3]);
  });
});

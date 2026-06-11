import { describe, expect, it } from "vitest";
import {
  formatFps,
  formatMb,
  formatMs,
  fpsFromIntervalMs,
  PerfWindow,
  summarizePerf,
} from "./perf-metrics";

describe("summarizePerf", () => {
  it("returns nulls for an empty list", () => {
    expect(summarizePerf([])).toEqual({
      avg: null,
      p50: null,
      p99: null,
      min: null,
      max: null,
      samples: 0,
    });
  });

  it("computes avg / min / max / percentiles (nearest-rank)", () => {
    const s = summarizePerf([10, 20, 30, 40, 50]);
    expect(s.avg).toBe(30);
    expect(s.min).toBe(10);
    expect(s.max).toBe(50);
    expect(s.p50).toBe(30);
    expect(s.p99).toBe(50);
    expect(s.samples).toBe(5);
  });

  it("ignores non-finite values", () => {
    const s = summarizePerf([10, Number.NaN, 30, Number.POSITIVE_INFINITY]);
    expect(s.samples).toBe(2);
    expect(s.avg).toBe(20);
  });
});

describe("PerfWindow", () => {
  it("keeps only the most recent `limit` samples", () => {
    const w = new PerfWindow(3);
    for (const v of [1, 2, 3, 4, 5]) w.push(v);
    const s = w.summary();
    expect(s.samples).toBe(3);
    expect(s.min).toBe(3); // 1,2 evicted
    expect(s.max).toBe(5);
  });

  it("drops non-finite pushes", () => {
    const w = new PerfWindow(5);
    w.push(16);
    w.push(Number.NaN);
    expect(w.summary().samples).toBe(1);
  });
});

describe("formatters", () => {
  it("fpsFromIntervalMs inverts the interval", () => {
    expect(fpsFromIntervalMs(16.67)).toBeCloseTo(60, 0);
    expect(fpsFromIntervalMs(0)).toBeNull();
    expect(fpsFromIntervalMs(null)).toBeNull();
  });

  it("formatMs keeps one decimal under 10ms", () => {
    expect(formatMs(8.4)).toBe("8.4ms");
    expect(formatMs(16.7)).toBe("17ms");
    expect(formatMs(null)).toBe("–");
  });

  it("formatFps / formatMb round", () => {
    expect(formatFps(59.6)).toBe("60");
    expect(formatFps(null)).toBe("–");
    expect(formatMb(1024 * 1024 * 42)).toBe("42MB");
    expect(formatMb(null)).toBe("–");
  });
});

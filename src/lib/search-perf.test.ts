import { afterEach, describe, expect, it } from "vitest";
import { createPerfSampler, observeLongTasks, percentile } from "./search-perf";

describe("percentile", () => {
  it("returns NaN for an empty set", () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it("returns the single value for a one-element set", () => {
    expect(percentile([42], 95)).toBe(42);
  });

  it("uses nearest-rank on a sorted set", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // nearest-rank: ceil(p/100 * n) - 1
    expect(percentile(xs, 50)).toBe(5); // ceil(5)-1 = idx 4 → 5
    expect(percentile(xs, 95)).toBe(10); // ceil(9.5)-1 = idx 9 → 10
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile(xs, 0)).toBe(1);
  });

  it("does not mutate the input array", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });

  it("sorts unsorted input before ranking", () => {
    expect(percentile([10, 1, 5, 3, 8], 50)).toBe(5);
  });
});

describe("createPerfSampler", () => {
  it("reports null stats when empty", () => {
    expect(createPerfSampler(10).stats()).toBeNull();
  });

  it("aggregates count / p50 / p95 / max / mean", () => {
    const s = createPerfSampler(100);
    for (const v of [10, 20, 30, 40, 50]) s.record(v);
    const stats = s.stats();
    expect(stats).not.toBeNull();
    expect(stats?.count).toBe(5);
    expect(stats?.max).toBe(50);
    expect(stats?.mean).toBe(30);
    expect(stats?.p50).toBe(30);
  });

  it("keeps only the last `capacity` samples (bounded ring)", () => {
    const s = createPerfSampler(3);
    for (const v of [1, 2, 3, 4, 5]) s.record(v); // 1,2 evicted → [3,4,5]
    const stats = s.stats();
    expect(stats?.count).toBe(3);
    expect(stats?.max).toBe(5);
    expect(stats?.mean).toBe(4);
  });

  it("ignores non-finite samples", () => {
    const s = createPerfSampler(10);
    s.record(Number.NaN);
    s.record(Number.POSITIVE_INFINITY);
    s.record(7);
    expect(s.stats()?.count).toBe(1);
    expect(s.stats()?.max).toBe(7);
  });

  it("reset() clears samples", () => {
    const s = createPerfSampler(10);
    s.record(1);
    s.reset();
    expect(s.stats()).toBeNull();
  });
});

describe("observeLongTasks", () => {
  const original = globalThis.PerformanceObserver;
  afterEach(() => {
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = original;
  });

  it("returns a no-op disposer when PerformanceObserver is unavailable", () => {
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = undefined;
    const dispose = observeLongTasks(() => {
      throw new Error("should never be called");
    });
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
  });

  it("returns a no-op disposer when the longtask entry type is unsupported", () => {
    class ThrowingObserver {
      observe() {
        throw new Error("unsupported entryType");
      }
      disconnect() {}
    }
    (globalThis as { PerformanceObserver?: unknown }).PerformanceObserver = ThrowingObserver;
    const dispose = observeLongTasks(() => {});
    expect(() => dispose()).not.toThrow();
  });
});

/**
 * Pure perf-sampling helpers for the search pipeline (PRD
 * `20260615-muzero-global-search-index-performance` Phase 1 — observability).
 *
 * The worker feeds query / build durations and the main thread feeds end-to-end
 * query latency into a bounded {@link PerfSampler}; the aggregated stats are
 * logged via `log.debug` (prod-silent). Kept pure + dependency-free so the ring
 * buffer and percentile maths are unit-testable and run identically on the main
 * thread and inside the Worker. No sample VALUES are ever surfaced to telemetry —
 * only counts and millisecond aggregates (see PRD §8 privacy).
 */

/**
 * Nearest-rank percentile of `values` (0–100). Returns `NaN` for an empty set.
 * Sorts a copy, so the caller's array is never mutated. Rank index is
 * `ceil(p/100 * n) - 1`, clamped to `[0, n-1]` — p0 → min, p100 → max.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index];
}

/** Aggregated view over the recorded samples (all milliseconds). */
export interface PerfStats {
  count: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

/** A bounded ring of millisecond samples with percentile/mean aggregation. */
export interface PerfSampler {
  /** Record one sample; non-finite values are ignored. */
  record(ms: number): void;
  /** Aggregated stats, or `null` when no samples have been recorded. */
  stats(): PerfStats | null;
  /** Drop all samples. */
  reset(): void;
}

/**
 * Create a sampler that retains at most the last `capacity` finite samples
 * (oldest evicted first), so a long-running session can't grow unbounded.
 */
export function createPerfSampler(capacity: number): PerfSampler {
  const ring: number[] = [];
  let next = 0;

  return {
    record(ms: number): void {
      if (!Number.isFinite(ms)) return;
      if (ring.length < capacity) {
        ring.push(ms);
      } else {
        ring[next] = ms;
        next = (next + 1) % capacity;
      }
    },
    stats(): PerfStats | null {
      if (ring.length === 0) return null;
      let sum = 0;
      let max = Number.NEGATIVE_INFINITY;
      for (const v of ring) {
        sum += v;
        if (v > max) max = v;
      }
      return {
        count: ring.length,
        p50: percentile(ring, 50),
        p95: percentile(ring, 95),
        max,
        mean: sum / ring.length,
      };
    },
    reset(): void {
      ring.length = 0;
      next = 0;
    },
  };
}

/**
 * Observe main-thread long tasks (≥50ms) via `PerformanceObserver`, calling
 * `onLongTask(durationMs)` for each. Returns a disposer. No-ops (returning a
 * no-op disposer) where `PerformanceObserver` or the `longtask` entry type is
 * unavailable (Node / jsdom / Safari) — this is the unambiguous before/after
 * signal for the open-window "顿一下" (PRD §4.1), not a behavior gate.
 */
export function observeLongTasks(onLongTask: (durationMs: number) => void): () => void {
  if (typeof PerformanceObserver === "undefined") return () => {};
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onLongTask(entry.duration);
    });
    observer.observe({ entryTypes: ["longtask"] });
    return () => observer.disconnect();
  } catch {
    return () => {};
  }
}

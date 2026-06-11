/**
 * Tiny perf-metric helpers for the dev overlay (FPS / frame cadence / memory).
 * Pure + dependency-free so the rolling-window math is unit-tested; the React
 * sampling lives in the dev panel. Inspired by ClipCombo's PreviewMetricWindow
 * (nearest-rank percentiles), trimmed to what MUZERO needs.
 */

export interface PerfSummary {
  avg: number | null;
  p50: number | null;
  p99: number | null;
  min: number | null;
  max: number | null;
  samples: number;
}

const EMPTY: PerfSummary = { avg: null, p50: null, p99: null, min: null, max: null, samples: 0 };

/** Fixed-size FIFO ring of recent numeric samples. */
export class PerfWindow {
  private readonly values: number[] = [];
  private readonly limit: number;

  constructor(limit = 180) {
    this.limit = Math.max(1, Math.floor(limit));
  }

  push(value: number): void {
    if (!Number.isFinite(value)) return;
    this.values.push(value);
    if (this.values.length > this.limit) this.values.shift();
  }

  summary(): PerfSummary {
    return summarizePerf(this.values);
  }
}

/** Nearest-rank percentile of an already-finite, unsorted list. */
export function summarizePerf(values: readonly number[]): PerfSummary {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return EMPTY;
  const sum = finite.reduce((a, b) => a + b, 0);
  return {
    avg: sum / finite.length,
    p50: percentile(finite, 0.5),
    p99: percentile(finite, 0.99),
    min: finite[0] ?? null,
    max: finite[finite.length - 1] ?? null,
    samples: finite.length,
  };
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? null;
}

/** Frames per second from a frame interval in ms. */
export function fpsFromIntervalMs(intervalMs: number | null): number | null {
  return intervalMs && intervalMs > 0 ? 1000 / intervalMs : null;
}

export function formatMs(value: number | null): string {
  if (value == null) return "–";
  return value < 10 ? `${value.toFixed(1)}ms` : `${Math.round(value)}ms`;
}

export function formatFps(value: number | null): string {
  if (value == null) return "–";
  return Math.round(value).toString();
}

export function formatMb(bytes: number | null): string {
  if (bytes == null) return "–";
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** Chrome/Electron-only JS heap usage in bytes (null elsewhere). */
export function readJsHeapBytes(): number | null {
  const mem = (globalThis.performance as Performance & { memory?: { usedJSHeapSize?: number } })
    ?.memory;
  return mem && typeof mem.usedJSHeapSize === "number" ? mem.usedJSHeapSize : null;
}

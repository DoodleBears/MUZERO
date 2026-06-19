import { coverDerivativeUrlCache, coverUrlCache } from "@/lib/object-url-cache";
import {
  blobUrlStats,
  installBlobUrlTracker,
  readPerfCounter,
  readPerfWork,
  resetPerfCounters,
  retainPerfCounters,
} from "@/lib/perf-counters";
import { fpsFromIntervalMs, PerfWindow, readJsHeapBytes } from "@/lib/perf-metrics";
import { traceEvent } from "@/lib/trace";

const DB_REQUERY_COUNTERS = [
  "db.listAllTracks",
  "db.memoryNotesByTrack",
  "db.trackPlaybackStats",
] as const;

const DEFAULT_FRAME_WINDOW_SIZE = 180;
const DEFAULT_LONGTASK_WINDOW_SIZE = 60;
const DEFAULT_LONGTASK_TRACE_MS = 50;
const DEFAULT_SNAPSHOT_MS = 500;
const DEFAULT_TRACE_SUMMARY_MS = 2500;
const WORK_TOP_MAX = 8;

type LongTaskEntry = PerformanceEntry & {
  attribution?: ReadonlyArray<{
    containerName?: string;
    containerSrc?: string;
    containerType?: string;
  }>;
};

export interface PerformanceTraceSamplerOptions {
  frameWindowSize?: number;
  label?: string;
  longTaskTraceMs?: number;
  resetCounters?: boolean;
  snapshotMs?: number;
  traceSummaryMs?: number;
}

export interface PerformanceTraceSamplerSnapshot {
  active: boolean;
  blobsPeakLive: number;
  blobsPeakLiveByKind: Record<string, number>;
  blobsPeakLiveBytes: number;
  blobsPeakLiveBytesByKind: Record<string, number>;
  coverDerivativeUrlCacheBytes: number;
  coverDerivativeUrlCacheReferencedBytes: number;
  coverDerivativeUrlCacheReferencedSize: number;
  coverDerivativeUrlCacheSize: number;
  coverDerivativeUrlCacheWarmBytes: number;
  coverDerivativeUrlCacheWarmSize: number;
  coverUrlCacheBytes: number;
  coverUrlCacheReferencedBytes: number;
  coverUrlCacheReferencedSize: number;
  coverUrlCacheSize: number;
  coverUrlCacheWarmBytes: number;
  coverUrlCacheWarmSize: number;
  frameMaxMs: number | null;
  frameP99Ms: number | null;
  frames: number;
  fpsAvg: number | null;
  fpsLow: number | null;
  heapMb: number | null;
  label: string;
  longTaskMaxMs: number | null;
  startedAt: number;
}

export interface PerformanceTraceSampler {
  snapshot: () => PerformanceTraceSamplerSnapshot;
  stop: () => PerformanceTraceSamplerSnapshot;
}

let activeSampler: PerformanceTraceSampler | null = null;

export function startPerformanceTraceSampler(
  options: PerformanceTraceSamplerOptions = {},
): PerformanceTraceSampler {
  activeSampler?.stop();
  const sampler = createPerformanceTraceSampler(options);
  activeSampler = sampler;
  return sampler;
}

export function stopPerformanceTraceSampler(): PerformanceTraceSamplerSnapshot {
  const sampler = activeSampler;
  if (!sampler) return inactiveSnapshot();
  activeSampler = null;
  return sampler.stop();
}

export function getPerformanceTraceSamplerStatus(): PerformanceTraceSamplerSnapshot {
  return activeSampler?.snapshot() ?? inactiveSnapshot();
}

function createPerformanceTraceSampler(
  options: PerformanceTraceSamplerOptions,
): PerformanceTraceSampler {
  const label = options.label?.trim() || "perf-control";
  const frameWindow = new PerfWindow(options.frameWindowSize ?? DEFAULT_FRAME_WINDOW_SIZE);
  const longTaskWindow = new PerfWindow(DEFAULT_LONGTASK_WINDOW_SIZE);
  const snapshotMs = Math.max(100, options.snapshotMs ?? DEFAULT_SNAPSHOT_MS);
  const traceSummaryMs = Math.max(snapshotMs, options.traceSummaryMs ?? DEFAULT_TRACE_SUMMARY_MS);
  const longTaskTraceMs = Math.max(0, options.longTaskTraceMs ?? DEFAULT_LONGTASK_TRACE_MS);
  const startedAt = Date.now();
  let lastFrameAt = 0;
  let lastTraceSummaryAt = 0;
  let active = true;
  let raf = 0;
  let interval = 0;
  let observer: PerformanceObserver | null = null;

  if (options.resetCounters ?? true) resetPerfCounters();
  const releaseCounters = retainPerfCounters();
  const uninstallBlobTracker = installBlobUrlTracker();

  const tick = (now: number) => {
    if (!active) return;
    if (lastFrameAt) frameWindow.push(now - lastFrameAt);
    lastFrameAt = now;
    raf = requestAnimationFrame(tick);
  };

  raf = requestAnimationFrame(tick);

  if (typeof PerformanceObserver !== "undefined") {
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskWindow.push(entry.duration);
          if (entry.duration < longTaskTraceMs) continue;
          const lt = entry as LongTaskEntry;
          const heapBytes = readJsHeapBytes();
          traceEvent("debug", "performance.longtask", "main-thread stall", {
            attribution: (lt.attribution ?? []).map((a) => ({
              containerName: a.containerName,
              containerSrc: a.containerSrc,
              containerType: a.containerType,
            })),
            culprit: entry.name,
            durationMs: roundMetric(entry.duration),
            heapMb: heapBytes == null ? null : Math.round(heapBytes / (1024 * 1024)),
            label,
            startMs: roundMetric(entry.startTime),
          });
        }
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      observer = null;
    }
  }

  const emitFrameTrace = (reason: "interval" | "stop") => {
    const frames = frameWindow.summary();
    if (frames.samples === 0) return;
    const now = Date.now();
    const jankyFrame = (frames.max ?? 0) >= longTaskTraceMs;
    if (reason === "interval" && !jankyFrame && now - lastTraceSummaryAt < traceSummaryMs) return;
    lastTraceSummaryAt = now;
    const blobs = blobUrlStats();
    const coverCache = objectUrlCacheSnapshot();
    const longTasks = longTaskWindow.summary();
    const heapBytes = readJsHeapBytes();
    const dbRequeries = DB_REQUERY_COUNTERS.reduce((sum, name) => sum + readPerfCounter(name), 0);
    traceEvent("debug", "performance.frame", "fps window", {
      blobsCreated: blobs.created,
      blobsCreatedByKind: blobs.createdByKind,
      blobsLive: blobs.live,
      blobsLiveByKind: blobs.liveByKind,
      blobsLiveBytes: blobs.liveBytes,
      blobsLiveBytesByKind: blobs.liveBytesByKind,
      blobsPeakLive: blobs.peakLive,
      blobsPeakLiveByKind: blobs.peakLiveByKind,
      blobsPeakLiveBytes: blobs.peakLiveBytes,
      blobsPeakLiveBytesByKind: blobs.peakLiveBytesByKind,
      coverDerivativeUrlCacheBytes: coverCache.derivativeBytes,
      coverDerivativeUrlCacheReferencedBytes: coverCache.derivativeReferencedBytes,
      coverDerivativeUrlCacheReferencedSize: coverCache.derivativeReferencedSize,
      coverDerivativeUrlCacheSize: coverCache.derivativeSize,
      coverDerivativeUrlCacheWarmBytes: coverCache.derivativeWarmBytes,
      coverDerivativeUrlCacheWarmSize: coverCache.derivativeWarmSize,
      coverUrlCacheBytes: coverCache.coverBytes,
      coverUrlCacheReferencedBytes: coverCache.coverReferencedBytes,
      coverUrlCacheReferencedSize: coverCache.coverReferencedSize,
      coverUrlCacheSize: coverCache.coverSize,
      coverUrlCacheWarmBytes: coverCache.coverWarmBytes,
      coverUrlCacheWarmSize: coverCache.coverWarmSize,
      dbRequeries,
      fpsAvg: roundMetric(fpsFromIntervalMs(frames.avg)),
      fpsLow: roundMetric(fpsFromIntervalMs(frames.max)),
      frameAvgMs: roundMetric(frames.avg),
      frameMaxMs: roundMetric(frames.max),
      frameP99Ms: roundMetric(frames.p99),
      heapMb: heapBytes == null ? null : Math.round(heapBytes / (1024 * 1024)),
      label,
      longTaskMaxMs: roundMetric(longTasks.max),
      reason,
      sampler: true,
      workTop: readPerfWork()
        .slice(0, WORK_TOP_MAX)
        .map((row) => ({
          avgMs: roundMetric(row.avgMs),
          count: row.count,
          lastMs: roundMetric(row.lastMs),
          maxMs: roundMetric(row.maxMs),
          name: row.name,
        })),
    });
  };

  interval = window.setInterval(() => emitFrameTrace("interval"), snapshotMs);
  traceEvent("debug", "performance.sampler", "started", { label, startedAt });

  const snapshot = (): PerformanceTraceSamplerSnapshot => {
    const frames = frameWindow.summary();
    const longTasks = longTaskWindow.summary();
    const blobs = blobUrlStats();
    const coverCache = objectUrlCacheSnapshot();
    const heapBytes = readJsHeapBytes();
    return {
      active,
      blobsPeakLive: blobs.peakLive,
      blobsPeakLiveByKind: blobs.peakLiveByKind,
      blobsPeakLiveBytes: blobs.peakLiveBytes,
      blobsPeakLiveBytesByKind: blobs.peakLiveBytesByKind,
      coverDerivativeUrlCacheBytes: coverCache.derivativeBytes,
      coverDerivativeUrlCacheReferencedBytes: coverCache.derivativeReferencedBytes,
      coverDerivativeUrlCacheReferencedSize: coverCache.derivativeReferencedSize,
      coverDerivativeUrlCacheSize: coverCache.derivativeSize,
      coverDerivativeUrlCacheWarmBytes: coverCache.derivativeWarmBytes,
      coverDerivativeUrlCacheWarmSize: coverCache.derivativeWarmSize,
      coverUrlCacheBytes: coverCache.coverBytes,
      coverUrlCacheReferencedBytes: coverCache.coverReferencedBytes,
      coverUrlCacheReferencedSize: coverCache.coverReferencedSize,
      coverUrlCacheSize: coverCache.coverSize,
      coverUrlCacheWarmBytes: coverCache.coverWarmBytes,
      coverUrlCacheWarmSize: coverCache.coverWarmSize,
      frameMaxMs: roundMetric(frames.max),
      frameP99Ms: roundMetric(frames.p99),
      frames: frames.samples,
      fpsAvg: roundMetric(fpsFromIntervalMs(frames.avg)),
      fpsLow: roundMetric(fpsFromIntervalMs(frames.max)),
      heapMb: heapBytes == null ? null : Math.round(heapBytes / (1024 * 1024)),
      label,
      longTaskMaxMs: roundMetric(longTasks.max),
      startedAt,
    };
  };

  const stop = () => {
    if (!active) return snapshot();
    active = false;
    cancelAnimationFrame(raf);
    window.clearInterval(interval);
    observer?.disconnect();
    emitFrameTrace("stop");
    const stopped = snapshot();
    traceEvent("debug", "performance.sampler", "stopped", stopped);
    releaseCounters();
    uninstallBlobTracker();
    return stopped;
  };

  return { snapshot, stop };
}

function inactiveSnapshot(): PerformanceTraceSamplerSnapshot {
  return {
    active: false,
    blobsPeakLive: 0,
    blobsPeakLiveByKind: {},
    blobsPeakLiveBytes: 0,
    blobsPeakLiveBytesByKind: {},
    coverDerivativeUrlCacheBytes: 0,
    coverDerivativeUrlCacheReferencedBytes: 0,
    coverDerivativeUrlCacheReferencedSize: 0,
    coverDerivativeUrlCacheSize: 0,
    coverDerivativeUrlCacheWarmBytes: 0,
    coverDerivativeUrlCacheWarmSize: 0,
    coverUrlCacheBytes: 0,
    coverUrlCacheReferencedBytes: 0,
    coverUrlCacheReferencedSize: 0,
    coverUrlCacheSize: 0,
    coverUrlCacheWarmBytes: 0,
    coverUrlCacheWarmSize: 0,
    frameMaxMs: null,
    frameP99Ms: null,
    frames: 0,
    fpsAvg: null,
    fpsLow: null,
    heapMb: null,
    label: "",
    longTaskMaxMs: null,
    startedAt: 0,
  };
}

function objectUrlCacheSnapshot() {
  const cover = coverUrlCache.stats();
  const derivative = coverDerivativeUrlCache.stats();
  return {
    coverBytes: cover.bytes,
    coverReferencedBytes: cover.referencedBytes,
    coverReferencedSize: cover.referencedSize,
    coverSize: cover.size,
    coverWarmBytes: cover.warmBytes,
    coverWarmSize: cover.warmSize,
    derivativeBytes: derivative.bytes,
    derivativeReferencedBytes: derivative.referencedBytes,
    derivativeReferencedSize: derivative.referencedSize,
    derivativeSize: derivative.size,
    derivativeWarmBytes: derivative.warmBytes,
    derivativeWarmSize: derivative.warmSize,
  };
}

function roundMetric(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

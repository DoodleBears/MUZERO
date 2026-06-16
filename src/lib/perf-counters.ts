/**
 * Perf-audit counters for the dev/Settings perf HUD (memory-perf-audit PRD,
 * Phase 1). Named counters + a blob-URL census, surfaced as rows in
 * `DevPerfPanel` and (for DB re-queries) as debug entries in the trace ring so
 * copy-trace exports carry them.
 *
 * Everything is gated behind an explicit enable flag set by the HUD on mount —
 * when the panel is not mounted the instrumentation call sites cost one boolean
 * check and allocate nothing (PRD: "默认关闭时零开销").
 */
import { traceEvent } from "@/lib/trace";

let enabled = false;
const counts = new Map<string, number>();
const perfWorkWindows = new Map<string, PerfWorkWindow>();
// Lifetime (HUD-session) per-name work stats for the perf panel breakdown. Kept
// SEPARATE from `perfWorkWindows` (which zero out on every trace emit) so the HUD
// can show a stable per-subcategory cost — last/avg/max/count — instead of one
// opaque total. Cleared by `resetPerfCounters` when the HUD unmounts.
const perfWorkStats = new Map<string, PerfWorkStat>();

export function setPerfCountersEnabled(on: boolean): void {
  enabled = on;
}

export function arePerfCountersEnabled(): boolean {
  return enabled;
}

/** Increment a named counter. No-op while the HUD is not mounted. */
export function bumpPerfCounter(name: string, delta = 1): void {
  if (!enabled) return;
  counts.set(name, (counts.get(name) ?? 0) + delta);
}

export function readPerfCounter(name: string): number {
  return counts.get(name) ?? 0;
}

export function resetPerfCounters(): void {
  counts.clear();
  requeryTraceWindows.clear();
  perfWorkWindows.clear();
  perfWorkStats.clear();
}

interface PerfWorkStat {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

export interface PerfWorkStatRow {
  name: string;
  count: number;
  avgMs: number;
  maxMs: number;
  lastMs: number;
}

/**
 * Per-name work-span breakdown for the perf HUD: every `notePerfWork` subcategory
 * with its last / average / max duration and call count over the HUD session,
 * sorted heaviest-max first. Empty while the HUD is not mounted.
 */
export function readPerfWork(): PerfWorkStatRow[] {
  const rows: PerfWorkStatRow[] = [];
  for (const [name, stat] of perfWorkStats) {
    rows.push({
      name,
      count: stat.count,
      avgMs: stat.count > 0 ? stat.totalMs / stat.count : 0,
      maxMs: stat.maxMs,
      lastMs: stat.lastMs,
    });
  }
  rows.sort((a, b) => b.maxMs - a.maxMs);
  return rows;
}

/** Per-query trace window — a Dexie write burst re-runs these queries once per
 *  transaction, and one ring entry per execution would flood the 300-entry ring
 *  AND amplify into the archive writer (PRD F-L4). */
const DB_REQUERY_TRACE_WINDOW_MS = 1000;
const requeryTraceWindows = new Map<string, { emittedAt: number; coalesced: number }>();

/**
 * Note one execution of a heavyweight DB query (`listAllTracks`-class full-table
 * reads). The counter counts EVERY execution (the HUD's `db` row stays exact);
 * the trace ring gets at most one line per query per window, carrying how many
 * executions it coalesced (finding F-3 observability). No-op while the HUD is
 * not mounted.
 */
export function noteDbRequery(query: string): void {
  if (!enabled) return;
  bumpPerfCounter(`db.${query}`);
  const now = Date.now();
  const window = requeryTraceWindows.get(query);
  if (window && now - window.emittedAt < DB_REQUERY_TRACE_WINDOW_MS) {
    window.coalesced += 1;
    return;
  }
  const coalesced = window?.coalesced ?? 0;
  requeryTraceWindows.set(query, { emittedAt: now, coalesced: 0 });
  traceEvent(
    "debug",
    "db",
    coalesced > 0 ? `${query} requery (+${coalesced} coalesced)` : `${query} requery`,
  );
}

// ------------------------------------------------------------ work spans --

const PERF_WORK_TRACE_WINDOW_MS = 1500;
const PERF_WORK_SLOW_MS = 8;

interface PerfWorkWindow {
  emittedAt: number;
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
  slowCount: number;
  lastData?: Record<string, unknown>;
}

function roundMs(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Record a named UI/rendering work span for trace diagnostics. Hot paths can call
 * this at frame rate: while disabled it is a no-op, and while enabled it emits a
 * coalesced trace row per work name instead of one row per frame.
 */
export function notePerfWork(
  name: string,
  durationMs: number,
  data?: Record<string, unknown>,
): void {
  if (!enabled || !Number.isFinite(durationMs)) return;
  bumpPerfCounter(`work.${name}`);
  // Lifetime per-name accumulation for the HUD breakdown (independent of the
  // trace-emit window below, which resets on emit).
  let stat = perfWorkStats.get(name);
  if (!stat) {
    stat = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
    perfWorkStats.set(name, stat);
  }
  stat.count += 1;
  stat.totalMs += durationMs;
  stat.maxMs = Math.max(stat.maxMs, durationMs);
  stat.lastMs = durationMs;
  const now = Date.now();
  let window = perfWorkWindows.get(name);
  if (!window) {
    window = {
      emittedAt: now,
      count: 0,
      totalMs: 0,
      maxMs: 0,
      lastMs: 0,
      slowCount: 0,
    };
    perfWorkWindows.set(name, window);
  }
  window.count += 1;
  window.totalMs += durationMs;
  window.maxMs = Math.max(window.maxMs, durationMs);
  window.lastMs = durationMs;
  if (durationMs >= PERF_WORK_SLOW_MS) window.slowCount += 1;
  window.lastData = data;

  const shouldEmit =
    durationMs >= PERF_WORK_SLOW_MS || now - window.emittedAt >= PERF_WORK_TRACE_WINDOW_MS;
  if (!shouldEmit) return;

  traceEvent("debug", "performance.work", name, {
    avgMs: roundMs(window.totalMs / Math.max(1, window.count)),
    count: window.count,
    lastMs: roundMs(window.lastMs),
    maxMs: roundMs(window.maxMs),
    slowCount: window.slowCount,
    ...(window.lastData ?? {}),
  });
  window.emittedAt = now;
  window.count = 0;
  window.totalMs = 0;
  window.maxMs = 0;
  window.lastMs = 0;
  window.slowCount = 0;
}

// ----------------------------------------------------------- blob URL census --

type BlobUrlKind = "audio" | "image" | "other" | "video";
type BlobUrlKindCounts = Record<BlobUrlKind, number>;

const EMPTY_BLOB_KIND_COUNTS: BlobUrlKindCounts = {
  audio: 0,
  image: 0,
  other: 0,
  video: 0,
};

/** Per-URL census record: its blob kind plus the byte size held until revoke. */
interface LiveBlobUrl {
  kind: BlobUrlKind;
  bytes: number;
}

const liveBlobUrls = new Map<string, LiveBlobUrl>();
let createdBlobUrls = 0;
let createdBlobUrlKinds: BlobUrlKindCounts = { ...EMPTY_BLOB_KIND_COUNTS };
let trackerRefs = 0;
let originalCreate: typeof URL.createObjectURL | null = null;
let originalRevoke: typeof URL.revokeObjectURL | null = null;

/**
 * Live (created − revoked) and total-created object URLs while the tracker is on,
 * plus the **live retained bytes** (sum of the source-blob sizes still un-revoked)
 * grouped by kind. The byte totals are the "memory 占用" signal the cover-original
 * experiment needs: a live count alone hides that one full-res cover holds far more
 * than one 160px thumbnail. (This is the source-blob byte size — the JS-side cost.
 * Chromium's decoded-bitmap / GPU memory lives outside `usedJSHeapSize` and is not
 * captured here; see the DevPerfPanel docs.)
 */
export function blobUrlStats(): {
  live: number;
  created: number;
  liveByKind: BlobUrlKindCounts;
  createdByKind: BlobUrlKindCounts;
  liveBytes: number;
  liveBytesByKind: BlobUrlKindCounts;
} {
  const liveByKind = { ...EMPTY_BLOB_KIND_COUNTS };
  const liveBytesByKind = { ...EMPTY_BLOB_KIND_COUNTS };
  let liveBytes = 0;
  for (const { kind, bytes } of liveBlobUrls.values()) {
    liveByKind[kind] += 1;
    liveBytesByKind[kind] += bytes;
    liveBytes += bytes;
  }
  return {
    live: liveBlobUrls.size,
    created: createdBlobUrls,
    liveByKind,
    createdByKind: { ...createdBlobUrlKinds },
    liveBytes,
    liveBytesByKind,
  };
}

/**
 * Wrap `URL.createObjectURL` / `URL.revokeObjectURL` with a census so the HUD
 * can show the live object-URL count — the unambiguous leak signal for blob:
 * leaks like F-1. Refcounted (StrictMode double-mounts install twice); the
 * returned uninstaller is idempotent and restores the originals when the last
 * consumer releases. Revokes of URLs created before install are ignored so the
 * live count never goes negative.
 */
export function installBlobUrlTracker(): () => void {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return () => {};
  }
  if (trackerRefs === 0) {
    liveBlobUrls.clear();
    createdBlobUrls = 0;
    createdBlobUrlKinds = { ...EMPTY_BLOB_KIND_COUNTS };
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    originalCreate = create;
    originalRevoke = revoke;
    URL.createObjectURL = ((blob: Blob | MediaSource) => {
      const url = create.call(URL, blob);
      const kind = classifyBlobUrlKind(blob);
      const bytes = typeof Blob !== "undefined" && blob instanceof Blob ? blob.size : 0;
      liveBlobUrls.set(url, { kind, bytes });
      createdBlobUrls += 1;
      createdBlobUrlKinds[kind] += 1;
      return url;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = ((url: string) => {
      revoke.call(URL, url);
      liveBlobUrls.delete(url);
    }) as typeof URL.revokeObjectURL;
  }
  trackerRefs += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    trackerRefs -= 1;
    if (trackerRefs > 0) return;
    if (originalCreate) URL.createObjectURL = originalCreate;
    if (originalRevoke) URL.revokeObjectURL = originalRevoke;
    originalCreate = null;
    originalRevoke = null;
    liveBlobUrls.clear();
  };
}

function classifyBlobUrlKind(blob: Blob | MediaSource): BlobUrlKind {
  if (typeof Blob !== "undefined" && blob instanceof Blob) {
    const mime = blob.type.toLowerCase();
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
  }
  return "other";
}

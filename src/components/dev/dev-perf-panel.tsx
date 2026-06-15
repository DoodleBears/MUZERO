import { Check, ClipboardCopy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import {
  blobUrlStats,
  installBlobUrlTracker,
  readPerfCounter,
  resetPerfCounters,
  setPerfCountersEnabled,
} from "@/lib/perf-counters";
import {
  formatFps,
  formatMb,
  formatMs,
  fpsFromIntervalMs,
  type PerfSummary,
  PerfWindow,
  readJsHeapBytes,
  summarizePerf,
} from "@/lib/perf-metrics";
import { formatTraceEntries, getTraceEntries, traceEvent } from "@/lib/trace";
import { cn } from "@/lib/utils";
import { usePlayerStore } from "@/stores/player-store";

/** Heavyweight full-table queries surfaced in the `db` row (PRD F-3/F-4). */
const DB_REQUERY_COUNTERS = [
  "db.listAllTracks",
  "db.memoryNotesByTrack",
  "db.trackPlaybackStats",
] as const;

/**
 * Floating dev-only perf HUD (FPS / frame cadence / long-task jank / JS heap).
 * Mounted only under `import.meta.env.DEV`. Frame cadence is the global rAF
 * interval — it reflects whether the flow background (or anything else) is
 * janking the main thread. Snapshots every 500ms so the panel itself stays cheap.
 */

const COLLAPSED_KEY = "muzero:dev-perf-collapsed";
const SNAPSHOT_MS = 500;
const TRACE_SUMMARY_MS = 2500;
// Emit a per-stall trace line for long tasks at/above this (the spec's own
// long-task floor is 50ms). The fps window only carries a rolling MAX, which
// tells you a jank happened SOMEWHERE in the window but not WHEN or against which
// switch / texture-swap / GC — so each stall is logged individually, timestamped
// in the ring, to be lined up against the surrounding playIndex/textureSwap/heap.
const LONGTASK_TRACE_MS = 50;

/** Minimal shape of a `longtask` PerformanceEntry (not in the TS lib dom types). */
type LongTaskEntry = PerformanceEntry & {
  attribution?: ReadonlyArray<{
    containerType?: string;
    containerName?: string;
    containerSrc?: string;
    containerId?: string;
  }>;
};

interface Snapshot {
  frames: PerfSummary;
  longTaskMax: number | null;
  heapBytes: number | null;
  blobsLive: number;
  blobsCreated: number;
  dbRequeries: number;
  traceCount: number;
}

const EMPTY_SNAPSHOT: Snapshot = {
  frames: summarizePerf([]),
  longTaskMax: null,
  heapBytes: null,
  blobsLive: 0,
  blobsCreated: 0,
  dbRequeries: 0,
  traceCount: 0,
};

export function DevPerfPanel() {
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [traceCopied, setTraceCopied] = useState(false);
  const framesRef = useRef(new PerfWindow(180));
  const longTasksRef = useRef(new PerfWindow(60));
  const lastTraceSummaryRef = useRef(0);
  const queueLength = usePlayerStore((s) => s.queue.length);

  // Counters + blob-URL census live only while the HUD is mounted — zero
  // overhead otherwise (memory-perf-audit PRD Phase 1).
  useEffect(() => {
    setPerfCountersEnabled(true);
    const uninstall = installBlobUrlTracker();
    return () => {
      setPerfCountersEnabled(false);
      resetPerfCounters();
      uninstall();
    };
  }, []);

  // Global frame cadence via rAF deltas.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (last) framesRef.current.push(t - last);
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ≥50ms main-thread stalls (Chromium only; no-op elsewhere).
  useEffect(() => {
    if (typeof PerformanceObserver === "undefined") return;
    let obs: PerformanceObserver | null = null;
    try {
      obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          longTasksRef.current.push(e.duration);
          if (e.duration < LONGTASK_TRACE_MS) continue;
          // Attribute the stall in the timeline. `culprit` (entry.name) is the
          // long-task spec's frame attribution ("self" = this frame's own script,
          // vs a child frame). `heapMb` here lets a stall that coincides with a
          // heap drop in the surrounding fps windows be read as a major-GC pause.
          const lt = e as LongTaskEntry;
          const heapBytes = readJsHeapBytes();
          traceEvent("debug", "performance.longtask", "main-thread stall", {
            attribution: (lt.attribution ?? []).map((a) => ({
              containerName: a.containerName,
              containerSrc: a.containerSrc,
              containerType: a.containerType,
            })),
            culprit: e.name,
            durationMs: roundMetric(e.duration),
            heapMb: heapBytes == null ? null : Math.round(heapBytes / (1024 * 1024)),
            startMs: roundMetric(e.startTime),
          });
        }
      });
      obs.observe({ entryTypes: ["longtask"] });
    } catch {
      obs = null;
    }
    return () => obs?.disconnect();
  }, []);

  // Throttled snapshot so the panel doesn't poll every frame.
  useEffect(() => {
    const id = window.setInterval(() => {
      const blobs = blobUrlStats();
      const frames = framesRef.current.summary();
      const longTasks = longTasksRef.current.summary();
      const heapBytes = readJsHeapBytes();
      const dbRequeries = DB_REQUERY_COUNTERS.reduce((sum, name) => sum + readPerfCounter(name), 0);
      setSnap({
        frames,
        longTaskMax: longTasks.max,
        heapBytes,
        blobsLive: blobs.live,
        blobsCreated: blobs.created,
        dbRequeries,
        // Polled, NOT subscribed — a useTraceEntries subscription would re-render
        // this HUD on every log line (PRD F-L5).
        traceCount: getTraceEntries().length,
      });
      const now = Date.now();
      const jankyFrame = (frames.max ?? 0) >= 50;
      const canEmit =
        now - lastTraceSummaryRef.current >= (jankyFrame ? SNAPSHOT_MS : TRACE_SUMMARY_MS);
      if (frames.samples > 0 && canEmit) {
        lastTraceSummaryRef.current = now;
        traceEvent("debug", "performance.frame", "fps window", {
          blobsCreated: blobs.created,
          blobsCreatedByKind: blobs.createdByKind,
          blobsLive: blobs.live,
          blobsLiveByKind: blobs.liveByKind,
          dbRequeries,
          fpsAvg: roundMetric(fpsFromIntervalMs(frames.avg)),
          fpsLow: roundMetric(fpsFromIntervalMs(frames.max)),
          frameAvgMs: roundMetric(frames.avg),
          frameMaxMs: roundMetric(frames.max),
          frameP99Ms: roundMetric(frames.p99),
          heapMb: heapBytes == null ? null : Math.round(heapBytes / (1024 * 1024)),
          longTaskMaxMs: roundMetric(longTasks.max),
          queueLength,
        });
      }
    }, SNAPSHOT_MS);
    return () => window.clearInterval(id);
  }, [queueLength]);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const copyAllTrace = async () => {
    const entries = getTraceEntries();
    if (!navigator.clipboard || entries.length === 0) return;
    await navigator.clipboard.writeText(formatTraceEntries(entries));
    setTraceCopied(true);
    window.setTimeout(() => setTraceCopied(false), 1600);
  };

  const fpsAvg = fpsFromIntervalMs(snap.frames.avg);
  const fpsLow = fpsFromIntervalMs(snap.frames.max); // worst frame interval → lowest fps
  const fpsColor =
    fpsAvg == null
      ? "text-white/60"
      : fpsAvg >= 55
        ? "text-emerald-400"
        : fpsAvg >= 30
          ? "text-amber-400"
          : "text-red-400";

  return (
    <div
      className="pointer-events-auto fixed bottom-3 left-3 z-[70] select-none rounded-md bg-black/75 font-mono text-[10px] text-white/90 leading-tight shadow-lg backdrop-blur-sm"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 px-2 py-1 text-left"
        title="Toggle perf panel"
      >
        <span>⚡</span>
        <span className={cn("font-semibold tabular-nums", fpsColor)}>{formatFps(fpsAvg)} fps</span>
        {collapsed && <span className="text-white/50">· {formatMb(snap.heapBytes)}</span>}
        <span className="ml-1 text-white/40">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-2 pb-1.5 tabular-nums">
          <Row label="fps low" value={`${formatFps(fpsLow)}`} />
          <Row
            label="frame"
            value={`${formatMs(snap.frames.avg)} · p99 ${formatMs(snap.frames.p99)}`}
          />
          <Row
            label="jank"
            value={snap.longTaskMax == null ? "–" : `max ${formatMs(snap.longTaskMax)}`}
          />
          <Row label="heap" value={formatMb(snap.heapBytes)} />
          <Row label="blobs" value={`${snap.blobsLive} live · ${snap.blobsCreated} made`} />
          <Row label="db" value={`${snap.dbRequeries} requeries`} />
          <Row label="queue" value={`${queueLength}`} />
          <button
            type="button"
            onClick={() => void copyAllTrace()}
            disabled={snap.traceCount === 0}
            className="col-span-2 mt-1 flex items-center justify-center gap-1 rounded border border-white/15 px-2 py-1 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Copy all trace"
          >
            {traceCopied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
            {traceCopied ? "copied" : `copy trace (${snap.traceCount})`}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Prod-build gate for the HUD, mounted in `main.tsx`. App.tsx owns the dev-build
 * mount behind the same visible Settings switch (`perfHudEnabled`, rule 3 — a
 * Settings control, not a hidden flag), so this renders nothing in dev.
 */
export function ProdPerfHud() {
  const settings = useSettings();
  if (import.meta.env.DEV || !settings.perfHudEnabled) return null;
  return <DevPerfPanel />;
}

function roundMetric(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-white/50">{label}</span>
      <span className="text-white/90">{value}</span>
    </>
  );
}

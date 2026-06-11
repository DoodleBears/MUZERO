import { Check, ClipboardCopy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { formatTraceEntries, useTraceEntries } from "@/lib/trace";
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

interface Snapshot {
  frames: PerfSummary;
  longTaskMax: number | null;
  heapBytes: number | null;
  blobsLive: number;
  blobsCreated: number;
  dbRequeries: number;
}

const EMPTY_SNAPSHOT: Snapshot = {
  frames: summarizePerf([]),
  longTaskMax: null,
  heapBytes: null,
  blobsLive: 0,
  blobsCreated: 0,
  dbRequeries: 0,
};

export function DevPerfPanel() {
  const [collapsed, setCollapsed] = useState(
    () => typeof localStorage !== "undefined" && localStorage.getItem(COLLAPSED_KEY) === "1",
  );
  const [snap, setSnap] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [traceCopied, setTraceCopied] = useState(false);
  const traceEntries = useTraceEntries();
  const framesRef = useRef(new PerfWindow(180));
  const longTasksRef = useRef(new PerfWindow(60));
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
        for (const e of list.getEntries()) longTasksRef.current.push(e.duration);
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
      setSnap({
        frames: framesRef.current.summary(),
        longTaskMax: longTasksRef.current.summary().max,
        heapBytes: readJsHeapBytes(),
        blobsLive: blobs.live,
        blobsCreated: blobs.created,
        dbRequeries: DB_REQUERY_COUNTERS.reduce((sum, name) => sum + readPerfCounter(name), 0),
      });
    }, SNAPSHOT_MS);
    return () => window.clearInterval(id);
  }, []);

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
    if (!navigator.clipboard || traceEntries.length === 0) return;
    await navigator.clipboard.writeText(formatTraceEntries(traceEntries));
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
            disabled={traceEntries.length === 0}
            className="col-span-2 mt-1 flex items-center justify-center gap-1 rounded border border-white/15 px-2 py-1 text-white/80 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            title="Copy all trace"
          >
            {traceCopied ? <Check className="size-3" /> : <ClipboardCopy className="size-3" />}
            {traceCopied ? "copied" : `copy trace (${traceEntries.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-white/50">{label}</span>
      <span className="text-white/90">{value}</span>
    </>
  );
}

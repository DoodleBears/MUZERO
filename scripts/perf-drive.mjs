#!/usr/bin/env node
// Dev-only perf scenario driver for the control endpoint (PRD 20260615-dev-control-endpoint,
// Phase 3 client). Reads .logs/perf-control.json, drives a scripted scenario through the
// 127.0.0.1 endpoint, then slices + aggregates the trace it writes to IndexedDB into a
// machine-readable perf report. Usage:
//   node scripts/perf-drive.mjs <switch|like|idle|counted|tabSwitch> [--switches N] [--every MS] [--settle MS] [--listen MS] [--name LABEL]
//   counted: play a track, dwell --listen ms (past the play threshold), then switch so
//            the outgoing track flushes a COUNTED play — the real switch-song trigger.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const scenario = process.argv[2] || "switch";
const switches = Number(arg("--switches", 8));
const everyMs = Number(arg("--every", 1500));
const settleMs = Number(arg("--settle", 6000));
const listenMs = Number(arg("--listen", 32000));
const name = arg("--name", scenario);
// search scenario: the query to type, and the per-keystroke cadence (ms).
const query = arg("--query", "love");
const typeMs = Number(arg("--type-every", 90));

let searchStats = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const res = await fetch(`${conn.url}${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${path} -> ${res.status} ${json.error}`);
  return json.data;
}

async function runSteps() {
  if (scenario === "pingpong") {
    // Alternate between two fixed indices so covers/derivatives cache after the first
    // visit — isolates the switch GAP from cold-cover work (switch-fps Phase 4).
    const base = (await call("GET", "/state")).currentIndex;
    const a = Math.max(0, base);
    const b = a + 1;
    for (let i = 0; i < switches; i += 1) {
      await call("POST", "/player/playIndex", { index: i % 2 === 0 ? b : a });
      if (i < switches - 1) await sleep(everyMs);
    }
    return;
  }
  if (scenario === "counted") {
    // Start a track, dwell past the play threshold, then switch so the OUTGOING track
    // flushes a counted play (the real switch-song trigger). Repeat `switches` times.
    await call("POST", "/player/playIndex", { index: "+1" });
    for (let i = 0; i < switches; i += 1) {
      await sleep(listenMs);
      await call("POST", "/player/playIndex", { index: "+1" });
    }
    return;
  }
  if (scenario === "search") {
    // Open ⌘F (Phase 2 open-window burst), then type the query one char at a time
    // (Phase 3 per-keystroke index latency) on the REAL overlay over the live library.
    // FPS/longtask land in the trace; search.perf latency comes back from /search stats.
    await call("POST", "/search", { action: "reset" });
    await call("POST", "/search", { action: "open" });
    await sleep(settleMs); // let the open-window work settle before typing
    let typed = "";
    for (const ch of [...query]) {
      typed += ch;
      await call("POST", "/search", { action: "type", query: typed });
      await sleep(typeMs);
    }
    await sleep(listenMs); // dwell so the final query resolves + frames sample
    searchStats = await call("POST", "/search", { action: "stats" });
    await call("POST", "/search", { action: "close" });
    return;
  }
  if (scenario === "metadata") {
    // Edit the CURRENT track's tags N times — a real `tracks` row write each time, the
    // scenario-4 fan-out probe (does a single-track edit refetch the whole queue?).
    for (let i = 0; i < switches; i += 1) {
      await call("POST", "/editMeta", {});
      if (i < switches - 1) await sleep(everyMs);
    }
    return;
  }
  if (scenario === "tabSwitch") {
    const tabs = ["queue", "search", "sessions", "settings", "now"];
    for (let i = 0; i < switches; i += 1) {
      const tab = tabs[i % tabs.length];
      await call("POST", "/perf/marker", {
        label: "tabSwitch.step",
        meta: { index: i, tab },
      });
      await call("POST", "/nav/tab", { tab });
      if (i < switches - 1) await sleep(everyMs);
    }
    return;
  }
  for (let i = 0; i < switches; i += 1) {
    if (scenario === "switch") await call("POST", "/player/playIndex", { index: "+1" });
    else if (scenario === "like") await call("POST", "/action/playback.like");
    else if (scenario === "idle") await call("GET", "/state");
    if (i < switches - 1) await sleep(everyMs);
  }
}

function val(entry) {
  return Array.isArray(entry.data) ? (entry.data[0] ?? {}) : (entry.data ?? {});
}

function aggregate(entries, samplerStart = null, samplerStop = null) {
  const frames = entries.filter((e) => e.scope === "performance.frame").map(val);
  const frameFallback = frames.length === 0 && samplerStop?.frames > 0 ? samplerStop : null;
  const frameMetricSource = frames.length ? "trace" : frameFallback ? "samplerStop" : "none";
  const markers = extractMarkers(entries);
  const longtasks = dedupeLongTasks(
    entries.filter((e) => e.scope === "performance.longtask").map(val),
  );
  const qFetch = entries
    .filter((e) => e.scope === "performance.work" && e.message === "queue.live.fetch")
    .map(val);
  const requeries = entries.filter((e) => e.scope === "db");
  const max = (xs) => (xs.length ? Math.max(...xs) : 0);
  const min = (xs) => (xs.length ? Math.min(...xs) : null);
  const kindValue = (obj, kind) => (typeof obj?.[kind] === "number" ? obj[kind] : 0);
  const heaps = frames.map((f) => f.heapMb).filter((x) => typeof x === "number");
  const heapStartMb = heaps.length ? heaps[0] : null;
  const heapEndMb = heaps.length ? heaps[heaps.length - 1] : null;
  const heapPeakMb = heaps.length ? max(heaps) : null;
  const heapMinMb = heaps.length ? min(heaps) : null;
  const fallbackHeapStartMb =
    heapStartMb == null && typeof samplerStart?.heapMb === "number" ? samplerStart.heapMb : null;
  const fallbackHeapEndMb =
    heapEndMb == null && typeof samplerStop?.heapMb === "number" ? samplerStop.heapMb : null;
  const fallbackHeapPeakMb =
    fallbackHeapStartMb == null && fallbackHeapEndMb == null
      ? null
      : Math.max(
          fallbackHeapStartMb ?? Number.NEGATIVE_INFINITY,
          fallbackHeapEndMb ?? Number.NEGATIVE_INFINITY,
        );
  const fallbackHeapMinMb =
    fallbackHeapStartMb == null && fallbackHeapEndMb == null
      ? null
      : Math.min(
          fallbackHeapStartMb ?? Number.POSITIVE_INFINITY,
          fallbackHeapEndMb ?? Number.POSITIVE_INFINITY,
        );
  const workTopAggregate = aggregateFrameWorkTop(frames);

  // Per-switch cost breakdown: group every performance.work subcategory by message
  // so we can see what dominates a switch (cover preload / image decode / mediaSession…).
  const workBreakdown = {};
  for (const e of entries.filter((x) => x.scope === "performance.work")) {
    const d = val(e);
    const b = (workBreakdown[e.message] ??= { count: 0, maxMs: 0, totalLastMs: 0 });
    b.count += 1;
    b.maxMs = Math.max(b.maxMs, d.maxMs ?? d.lastMs ?? 0);
    b.totalLastMs += d.lastMs ?? 0;
  }
  for (const k of Object.keys(workBreakdown)) {
    workBreakdown[k].totalLastMs = Math.round(workBreakdown[k].totalLastMs);
  }
  const workStatsAggregate = aggregateWorkStats(
    entries.filter((x) => x.scope === "performance.work"),
  );
  const derivativeBreakdown = {};
  for (const e of entries.filter(
    (x) => x.scope === "performance.work" && x.message === "cover.derivative.extract",
  )) {
    const d = val(e);
    const key = `${d.traceSource ?? "unknown"}:${d.kind ?? "unknown"}`;
    const b = (derivativeBreakdown[key] ??= { count: 0, maxMs: 0, totalLastMs: 0 });
    b.count += 1;
    b.maxMs = Math.max(b.maxMs, d.maxMs ?? d.lastMs ?? 0);
    b.totalLastMs += d.lastMs ?? 0;
  }
  for (const k of Object.keys(derivativeBreakdown)) {
    derivativeBreakdown[k].totalLastMs = Math.round(derivativeBreakdown[k].totalLastMs);
  }

  // §2.5 double-decode probe: background image load/decode whose <img> is gated out
  // under Pixi (pixiActive:true) = wasted main-thread-ish decode work per switch.
  const bgImg = entries.filter(
    (e) =>
      e.scope === "performance.work" &&
      (e.message === "image.decode" || e.message === "image.load") &&
      val(e).surface === "background",
  );
  const switchToFrame = entries
    .filter((e) => e.scope === "performance.work" && e.message === "player.switch.toFrame")
    .map((e) => val(e).lastMs ?? 0);

  return {
    workBreakdown,
    workStatsAggregate,
    derivativeBreakdown,
    workTopAggregate,
    frameMetricSource,
    switchToFrameMaxMs: max(switchToFrame),
    switchToFrameAvgMs: switchToFrame.length
      ? Math.round(switchToFrame.reduce((s, x) => s + x, 0) / switchToFrame.length)
      : 0,
    bgDecodeTotal: bgImg.length,
    bgDecodeWastedUnderPixi: bgImg.filter((e) => val(e).pixiActive === true).length,
    fpsLowMin:
      min(frames.map((f) => f.fpsLow).filter((x) => typeof x === "number")) ??
      frameFallback?.fpsLow ??
      null,
    fpsAvgMin:
      min(frames.map((f) => f.fpsAvg).filter((x) => typeof x === "number")) ??
      frameFallback?.fpsAvg ??
      null,
    frameMaxMs: frames.length
      ? max(frames.map((f) => f.frameMaxMs ?? 0))
      : (frameFallback?.frameMaxMs ?? 0),
    frameP99Ms: frames.length
      ? max(frames.map((f) => f.frameP99Ms ?? 0))
      : (frameFallback?.frameP99Ms ?? 0),
    maxBlobLive: frames.length
      ? max(frames.map((f) => f.blobsPeakLive ?? f.blobsLive ?? 0))
      : (frameFallback?.blobsPeakLive ?? 0),
    maxBlobLiveBytes: frames.length
      ? max(frames.map((f) => f.blobsPeakLiveBytes ?? f.blobsLiveBytes ?? 0))
      : (frameFallback?.blobsPeakLiveBytes ?? 0),
    maxAudioBlobLive: max(
      frames.length
        ? frames.map((f) => kindValue(f.blobsPeakLiveByKind ?? f.blobsLiveByKind, "audio"))
        : [kindValue(frameFallback?.blobsPeakLiveByKind, "audio")],
    ),
    maxAudioBlobLiveBytes: max(
      frames.length
        ? frames.map((f) =>
            kindValue(f.blobsPeakLiveBytesByKind ?? f.blobsLiveBytesByKind, "audio"),
          )
        : [kindValue(frameFallback?.blobsPeakLiveBytesByKind, "audio")],
    ),
    maxImageBlobLive: max(
      frames.length
        ? frames.map((f) => kindValue(f.blobsPeakLiveByKind ?? f.blobsLiveByKind, "image"))
        : [kindValue(frameFallback?.blobsPeakLiveByKind, "image")],
    ),
    maxImageBlobLiveBytes: max(
      frames.length
        ? frames.map((f) =>
            kindValue(f.blobsPeakLiveBytesByKind ?? f.blobsLiveBytesByKind, "image"),
          )
        : [kindValue(frameFallback?.blobsPeakLiveBytesByKind, "image")],
    ),
    maxVideoBlobLive: max(
      frames.length
        ? frames.map((f) => kindValue(f.blobsPeakLiveByKind ?? f.blobsLiveByKind, "video"))
        : [kindValue(frameFallback?.blobsPeakLiveByKind, "video")],
    ),
    maxVideoBlobLiveBytes: max(
      frames.length
        ? frames.map((f) =>
            kindValue(f.blobsPeakLiveBytesByKind ?? f.blobsLiveBytesByKind, "video"),
          )
        : [kindValue(frameFallback?.blobsPeakLiveBytesByKind, "video")],
    ),
    maxCoverUrlCacheBytes: frames.length
      ? max(frames.map((f) => f.coverUrlCacheBytes ?? 0))
      : (frameFallback?.coverUrlCacheBytes ?? 0),
    maxCoverUrlCacheSize: frames.length
      ? max(frames.map((f) => f.coverUrlCacheSize ?? 0))
      : (frameFallback?.coverUrlCacheSize ?? 0),
    maxCoverUrlCacheReferencedBytes: frames.length
      ? max(frames.map((f) => f.coverUrlCacheReferencedBytes ?? 0))
      : (frameFallback?.coverUrlCacheReferencedBytes ?? 0),
    maxCoverUrlCacheReferencedSize: frames.length
      ? max(frames.map((f) => f.coverUrlCacheReferencedSize ?? 0))
      : (frameFallback?.coverUrlCacheReferencedSize ?? 0),
    maxCoverUrlCacheWarmBytes: frames.length
      ? max(frames.map((f) => f.coverUrlCacheWarmBytes ?? 0))
      : (frameFallback?.coverUrlCacheWarmBytes ?? 0),
    maxCoverUrlCacheWarmSize: frames.length
      ? max(frames.map((f) => f.coverUrlCacheWarmSize ?? 0))
      : (frameFallback?.coverUrlCacheWarmSize ?? 0),
    maxCoverDerivativeUrlCacheBytes: frames.length
      ? max(frames.map((f) => f.coverDerivativeUrlCacheBytes ?? 0))
      : (frameFallback?.coverDerivativeUrlCacheBytes ?? 0),
    maxCoverDerivativeUrlCacheSize: frames.length
      ? max(frames.map((f) => f.coverDerivativeUrlCacheSize ?? 0))
      : (frameFallback?.coverDerivativeUrlCacheSize ?? 0),
    maxCoverDerivativeUrlCacheReferencedBytes: max(
      frames.length
        ? frames.map((f) => f.coverDerivativeUrlCacheReferencedBytes ?? 0)
        : [frameFallback?.coverDerivativeUrlCacheReferencedBytes ?? 0],
    ),
    maxCoverDerivativeUrlCacheReferencedSize: max(
      frames.length
        ? frames.map((f) => f.coverDerivativeUrlCacheReferencedSize ?? 0)
        : [frameFallback?.coverDerivativeUrlCacheReferencedSize ?? 0],
    ),
    maxCoverDerivativeUrlCacheWarmBytes: max(
      frames.length
        ? frames.map((f) => f.coverDerivativeUrlCacheWarmBytes ?? 0)
        : [frameFallback?.coverDerivativeUrlCacheWarmBytes ?? 0],
    ),
    maxCoverDerivativeUrlCacheWarmSize: max(
      frames.length
        ? frames.map((f) => f.coverDerivativeUrlCacheWarmSize ?? 0)
        : [frameFallback?.coverDerivativeUrlCacheWarmSize ?? 0],
    ),
    longTaskCount: longtasks.length,
    longTaskMaxMs: max(longtasks.map((l) => l.durationMs ?? 0)),
    longTaskTotalMs: Math.round(longtasks.reduce((s, l) => s + (l.durationMs ?? 0), 0)),
    longTaskTop: longtasks
      .map((task) => ({
        culprit: task.culprit ?? null,
        durationMs: task.durationMs ?? 0,
        heapMb: task.heapMb ?? null,
        nearestMarker: nearestMarker(markers, task.startMs),
        startMs: task.startMs ?? null,
      }))
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10),
    queueLiveFetchCount: qFetch.length,
    queueLiveFetchMaxMs: max(qFetch.map((q) => q.maxMs ?? q.lastMs ?? 0)),
    dbRequeryEntries: requeries.map((e) => e.message),
    dbRequeriesMax: max(frames.map((f) => f.dbRequeries ?? 0)),
    heapStartMb: heapStartMb ?? fallbackHeapStartMb,
    heapPeakMb: heapPeakMb ?? fallbackHeapPeakMb,
    heapEndMb: heapEndMb ?? fallbackHeapEndMb,
    heapMinMb: heapMinMb ?? fallbackHeapMinMb,
    heapDeltaMb:
      (heapStartMb ?? fallbackHeapStartMb) == null || (heapPeakMb ?? fallbackHeapPeakMb) == null
        ? null
        : (heapPeakMb ?? fallbackHeapPeakMb) - (heapStartMb ?? fallbackHeapStartMb),
    heapRetainedApproxMb:
      (heapStartMb ?? fallbackHeapStartMb) == null || (heapEndMb ?? fallbackHeapEndMb) == null
        ? null
        : (heapEndMb ?? fallbackHeapEndMb) - (heapStartMb ?? fallbackHeapStartMb),
    frameWindows: frames.length,
    samplerFrames: samplerStop?.frames ?? null,
  };
}

function extractMarkers(entries) {
  return entries
    .filter((entry) => entry.scope === "perf.control" && entry.message === "marker")
    .map((entry) => {
      const data = val(entry);
      return {
        at: entry.at ?? null,
        index: data.index ?? null,
        label: data.label ?? null,
        perfNow: typeof data.perfNow === "number" ? data.perfNow : null,
        tab: data.tab ?? null,
      };
    })
    .filter((marker) => marker.perfNow != null)
    .sort((a, b) => a.perfNow - b.perfNow);
}

function nearestMarker(markers, startMs) {
  if (typeof startMs !== "number" || markers.length === 0) return null;
  let best = null;
  for (const marker of markers) {
    if (marker.perfNow > startMs) break;
    best = marker;
  }
  if (!best) return null;
  return {
    deltaMs: Math.round((startMs - best.perfNow) * 10) / 10,
    index: best.index,
    label: best.label,
    tab: best.tab,
  };
}

function aggregateWorkStats(entries) {
  const sumFields = [
    "cacheHits",
    "canceled",
    "count",
    "created",
    "cropped",
    "inflightHits",
    "local",
    "remote",
    "requests",
    "roleCurrent",
    "roleNext",
    "rolePrevious",
    "roleSettle",
    "roleStack",
    "slowCount",
    "stale",
  ];
  const maxFields = ["maxMs", "lastMs", "avgMs", "maxSourceBytes"];
  const out = {};
  for (const entry of entries) {
    const data = val(entry);
    const row = (out[entry.message] ??= { emitted: 0 });
    row.emitted += 1;
    for (const field of sumFields) {
      const value = Number(data[field]);
      if (Number.isFinite(value)) row[field] = (row[field] ?? 0) + value;
    }
    for (const field of maxFields) {
      const value = Number(data[field]);
      if (Number.isFinite(value)) row[field] = Math.max(row[field] ?? 0, value);
    }
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1].emitted - a[1].emitted));
}

function dedupeLongTasks(longtasks) {
  const seen = new Set();
  const out = [];
  for (const task of longtasks) {
    const key = `${task.startMs ?? ""}:${task.durationMs ?? ""}:${task.culprit ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(task);
  }
  return out;
}

function aggregateFrameWorkTop(frames) {
  const rows = new Map();
  for (const frame of frames) {
    if (!Array.isArray(frame.workTop)) continue;
    for (const row of frame.workTop) {
      if (!row?.name) continue;
      const name = String(row.name);
      const current = rows.get(name) ?? {
        count: 0,
        maxMs: 0,
        totalAvgMs: 0,
        totalCount: 0,
        lastMs: 0,
        windows: 0,
      };
      current.count = Math.max(current.count, Number(row.count) || 0);
      current.maxMs = Math.max(current.maxMs, Number(row.maxMs) || 0);
      current.lastMs = Number(row.lastMs) || current.lastMs;
      current.totalAvgMs += Number(row.avgMs) || 0;
      current.totalCount += Number(row.count) || 0;
      current.windows += 1;
      rows.set(name, current);
    }
  }
  return Object.fromEntries(
    [...rows.entries()]
      .map(([name, row]) => [
        name,
        {
          avgMaxMs: row.windows ? Math.round((row.totalAvgMs / row.windows) * 10) / 10 : 0,
          count: row.count,
          lastMs: Math.round(row.lastMs * 10) / 10,
          maxMs: Math.round(row.maxMs * 10) / 10,
          totalCount: row.totalCount,
          windows: row.windows,
        },
      ])
      .sort((a, b) => b[1].maxMs - a[1].maxMs),
  );
}

function aggregateRenderTrace(snapshot) {
  const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
  const round = (value) => Math.round((Number(value) || 0) * 10) / 10;
  const mapEntry = (entry) => ({
    actualMs: round(entry.actualMs),
    commits: Number(entry.commits) || 0,
    hiddenActualMs: round(entry.hiddenActualMs),
    hiddenCommits: Number(entry.hiddenCommits) || 0,
    id: String(entry.id ?? ""),
    mountCommits: Number(entry.mountCommits) || 0,
    updateCommits: Number(entry.updateCommits) || 0,
  });
  return {
    renderTraceEntries: entries.length,
    renderTraceTop: entries
      .map(mapEntry)
      .filter((entry) => entry.actualMs > 0)
      .sort((a, b) => b.actualMs - a.actualMs)
      .slice(0, 12),
    hiddenRenderTraceTop: entries
      .map(mapEntry)
      .filter((entry) => entry.hiddenActualMs > 0)
      .sort((a, b) => b.hiddenActualMs - a.hiddenActualMs)
      .slice(0, 12),
  };
}

const state0 = await call("GET", "/state");
const startedAt = Date.now();
await call("POST", "/renderTrace", { action: "reset" }).catch(() => null);
const samplerStart = await call("POST", "/perf/sampler", { action: "start", label: name });
let samplerStop = null;
try {
  await call("POST", "/perf/marker", { label: "scenario.start", meta: { scenario: name } });
  await runSteps();
  await call("POST", "/perf/marker", { label: "scenario.end", meta: { scenario: name } });
} finally {
  samplerStop = await call("POST", "/perf/sampler", { action: "stop" }).catch((error) => ({
    error: String(error?.message ?? error),
  }));
}
await sleep(settleMs); // let the cascade play out + archive flush (debounced 1s)
const dump = await call("POST", "/perf/trace", { since: startedAt });
const renderTrace = await call("POST", "/renderTrace", {}).catch((error) => ({
  error: String(error?.message ?? error),
}));
const report = {
  scenario: name,
  branch: process.env.GIT_BRANCH || "(unknown)",
  queueLength: state0.queueLength,
  switches,
  everyMs,
  settleMs,
  startedAt,
  samplerStart,
  samplerStop,
  traceEntries: dump.count,
  ...(scenario === "search" ? { query, typeMs, searchStats } : {}),
  ...aggregateRenderTrace(renderTrace),
  ...aggregate(dump.entries, samplerStart, samplerStop),
};

const dir = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${name}-${startedAt}.json`);
writeFileSync(file, JSON.stringify({ report, entriesSlice: dump.entries.length }, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nreport saved: ${path.relative(process.cwd(), file)}`);

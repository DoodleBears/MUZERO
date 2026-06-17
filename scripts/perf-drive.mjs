#!/usr/bin/env node
// Dev-only perf scenario driver for the control endpoint (PRD 20260615-dev-control-endpoint,
// Phase 3 client). Reads .logs/perf-control.json, drives a scripted scenario through the
// 127.0.0.1 endpoint, then slices + aggregates the trace it writes to IndexedDB into a
// machine-readable perf report. Usage:
//   node scripts/perf-drive.mjs <switch|like|idle|counted> [--switches N] [--every MS] [--settle MS] [--listen MS] [--name LABEL]
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

function aggregate(entries) {
  const frames = entries.filter((e) => e.scope === "performance.frame").map(val);
  const longtasks = entries.filter((e) => e.scope === "performance.longtask").map(val);
  const qFetch = entries
    .filter((e) => e.scope === "performance.work" && e.message === "queue.live.fetch")
    .map(val);
  const requeries = entries.filter((e) => e.scope === "db");
  const max = (xs) => (xs.length ? Math.max(...xs) : 0);
  const min = (xs) => (xs.length ? Math.min(...xs) : null);
  const heaps = frames.map((f) => f.heapMb).filter((x) => typeof x === "number");

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
    switchToFrameMaxMs: max(switchToFrame),
    switchToFrameAvgMs: switchToFrame.length
      ? Math.round(switchToFrame.reduce((s, x) => s + x, 0) / switchToFrame.length)
      : 0,
    bgDecodeTotal: bgImg.length,
    bgDecodeWastedUnderPixi: bgImg.filter((e) => val(e).pixiActive === true).length,
    fpsLowMin: min(frames.map((f) => f.fpsLow).filter((x) => typeof x === "number")),
    fpsAvgMin: min(frames.map((f) => f.fpsAvg).filter((x) => typeof x === "number")),
    frameMaxMs: max(frames.map((f) => f.frameMaxMs ?? 0)),
    frameP99Ms: max(frames.map((f) => f.frameP99Ms ?? 0)),
    longTaskCount: longtasks.length,
    longTaskMaxMs: max(longtasks.map((l) => l.durationMs ?? 0)),
    longTaskTotalMs: Math.round(longtasks.reduce((s, l) => s + (l.durationMs ?? 0), 0)),
    queueLiveFetchCount: qFetch.length,
    queueLiveFetchMaxMs: max(qFetch.map((q) => q.maxMs ?? q.lastMs ?? 0)),
    dbRequeryEntries: requeries.map((e) => e.message),
    dbRequeriesMax: max(frames.map((f) => f.dbRequeries ?? 0)),
    heapDeltaMb: heaps.length ? max(heaps) - heaps[0] : 0,
    frameWindows: frames.length,
  };
}

const state0 = await call("GET", "/state");
const startedAt = Date.now();
await call("POST", "/perf/marker", { label: "scenario.start", meta: { scenario: name } });
await runSteps();
await call("POST", "/perf/marker", { label: "scenario.end", meta: { scenario: name } });
await sleep(settleMs); // let the cascade play out + archive flush (debounced 1s)
const dump = await call("POST", "/perf/trace", { since: startedAt });
const report = {
  scenario: name,
  branch: process.env.GIT_BRANCH || "(unknown)",
  queueLength: state0.queueLength,
  switches,
  everyMs,
  settleMs,
  startedAt,
  traceEntries: dump.count,
  ...(scenario === "search" ? { query, typeMs, searchStats } : {}),
  ...aggregate(dump.entries),
};

const dir = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${name}-${startedAt}.json`);
writeFileSync(file, JSON.stringify({ report, entriesSlice: dump.entries.length }, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nreport saved: ${path.relative(process.cwd(), file)}`);

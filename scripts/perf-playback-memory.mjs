// Playback memory harness for Electron profile builds.
//   1) pnpm electron:profile
//   2) node scripts/perf-playback-memory.mjs [debugPort=39222]
//
// Captures idle -> playing deltas from:
// - Electron app.getAppMetrics() via the dev-only perf-control /processes endpoint
// - Renderer JS heap via Chrome DevTools Protocol (best effort)
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const debugPort = Number(process.argv[2] ?? process.env.MUZERO_REMOTE_DEBUG_PORT ?? 39222);
const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const headers = {
  "content-type": "application/json",
  "x-muzero-perf-token": conn.token,
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ctl(method, route, body) {
  const response = await fetch(`${conn.url}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `${method} ${route} failed: ${response.status}`);
  }
  return payload.data;
}

async function connectHeapProbe() {
  try {
    const target = await pickPageTarget(debugPort);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("HeapProfiler.enable");
    await cdp.send("Performance.enable");
    return cdp;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function collectHeap(cdp) {
  if (!cdp || cdp.error) return null;
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(250);
  const { metrics } = await cdp.send("Performance.getMetrics");
  const read = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;
  return {
    jsHeapTotalMb: mb(read("JSHeapTotalSize")),
    jsHeapUsedMb: mb(read("JSHeapUsedSize")),
  };
}

async function snapshot(label, cdp) {
  const [state, processes, heap] = await Promise.all([
    ctl("GET", "/state"),
    ctl("GET", "/processes"),
    collectHeap(cdp),
  ]);
  return { heap, label, processes, state };
}

function summarize(snapshot) {
  const rows = snapshot.processes.processes;
  const byType = snapshot.processes.totals.byType;
  const tab = largest(rows, "Tab");
  const renderer = largest(rows, "Renderer");
  const gpu = largest(rows, "GPU");
  const audio = rows.find((row) => row.name === "Audio Service") || largest(rows, "Utility");
  return {
    audioWorkingSetMb: audio?.memory.workingSetMb ?? 0,
    gpuPrivateMb: gpu?.memory.privateMb ?? 0,
    gpuWorkingSetMb: gpu?.memory.workingSetMb ?? 0,
    isPlaying: snapshot.state.isPlaying,
    jsHeapUsedMb: snapshot.heap?.jsHeapUsedMb ?? null,
    queueLength: snapshot.state.queueLength,
    tabPrivateMb: tab?.memory.privateMb ?? renderer?.memory.privateMb ?? 0,
    tabWorkingSetMb: tab?.memory.workingSetMb ?? renderer?.memory.workingSetMb ?? 0,
    totalPrivateMb: snapshot.processes.totals.privateMb,
    totalWorkingSetMb: snapshot.processes.totals.workingSetMb,
    typeTotals: byType,
  };
}

function largest(rows, type) {
  return rows
    .filter((row) => row.type === type)
    .sort((a, b) => b.memory.workingSetMb - a.memory.workingSetMb)[0];
}

function delta(after, before) {
  const out = {};
  for (const key of [
    "audioWorkingSetMb",
    "gpuPrivateMb",
    "gpuWorkingSetMb",
    "tabPrivateMb",
    "tabWorkingSetMb",
    "totalPrivateMb",
    "totalWorkingSetMb",
  ]) {
    out[key] = round((after[key] ?? 0) - (before[key] ?? 0));
  }
  out.jsHeapUsedMb =
    after.jsHeapUsedMb == null || before.jsHeapUsedMb == null
      ? null
      : round(after.jsHeapUsedMb - before.jsHeapUsedMb);
  return out;
}

function mb(bytes) {
  return round(bytes / 1e6);
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function printSummary(result) {
  console.log(JSON.stringify(result, null, 2));
  console.log("");
  console.log("metric                 idle MB   playing MB   delta MB");
  console.log("-------------------------------------------------------");
  for (const [label, key] of [
    ["total working set", "totalWorkingSetMb"],
    ["tab working set", "tabWorkingSetMb"],
    ["gpu working set", "gpuWorkingSetMb"],
    ["audio working set", "audioWorkingSetMb"],
    ["renderer JS heap", "jsHeapUsedMb"],
  ]) {
    const idle = result.idle[key];
    const playing = result.playing[key];
    const d = result.delta[key];
    console.log(
      `${label.padEnd(22)} ${fmt(idle).padStart(7)} ${fmt(playing).padStart(12)} ${fmt(d).padStart(10)}`,
    );
  }
}

function fmt(value) {
  return value == null ? "n/a" : Number(value).toFixed(1);
}

let cdp = null;
try {
  cdp = await connectHeapProbe();
  let seededExample = false;
  let idleRaw = await snapshot("idle", cdp);
  let idle = summarize(idleRaw);
  if (idle.queueLength <= 0) {
    await ctl("POST", "/seed/example", {});
    seededExample = true;
    await sleep(1000);
    idleRaw = await snapshot("idle", cdp);
    idle = summarize(idleRaw);
  }

  const index = Math.max(0, idleRaw.state.currentIndex ?? 0);
  await ctl("POST", "/player/playIndex", { index });
  await sleep(6000);
  const playingRaw = await snapshot("playing", cdp);
  const playing = summarize(playingRaw);

  const result = {
    capturedAt: new Date().toISOString(),
    debugPort,
    delta: delta(playing, idle),
    heapProbe: cdp.error ? { error: cdp.error } : { ok: true },
    idle,
    playing,
    seededExample,
  };
  printSummary(result);
} finally {
  try {
    await ctl("POST", "/player/pause", {});
  } catch {
    // Best effort: the window may have closed during a harness run.
  }
  if (cdp && !cdp.error) cdp.close();
}

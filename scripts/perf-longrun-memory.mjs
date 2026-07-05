#!/usr/bin/env node
// Long-run playback memory attribution driver (memory-leak PRD 20260705 Phase 0).
//
// Drives the REAL running app over the dev control endpoint: plays N streamed
// tracks back-to-back (download-before-play exercises the H-1 path), sampling
//   - Electron MAIN process working set / private bytes (/processes.mainProcess
//     + app.getAppMetrics rows) — the process the 2.8GB screenshot indicts
//   - renderer JS heap (CDP, best-effort)
//   - bounded-cache sizes + playbackCache/mediaBlobs storage-backend split
//     (GET /memory/diag) — Q-2: OPFS vs inline-IndexedDB
// then runs the cheap H-1 attribution experiment: force a renderer GC and watch
// whether main-process memory falls (renderer Blob handles pinning main-side
// blob-storage bytes = lazy-GC theory confirmed).
//
// Usage: node scripts/perf-longrun-memory.mjs [--switches 14] [--dwell 9000]
//        [--port 39222] [--step 137] [--local-only] [--play-timeout 45000] [--no-gc]
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const conn = JSON.parse(
  readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"),
);
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const switches = Number(arg("--switches", 14));
const dwellMs = Number(arg("--dwell", 9000));
const debugPort = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT ?? 39222));
// A prime-ish stride spreads picks across a large queue → mostly uncached tracks.
const step = Number(arg("--step", 137));
const doGc = !process.argv.includes("--no-gc");
const localOnly = process.argv.includes("--local-only");
const playTimeoutMs = Number(arg("--play-timeout", 45_000));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, body, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${conn.url}${p}`, {
      method,
      headers: HEADERS,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller?.signal,
    });
    const json = await res.json();
    if (!json.ok) throw new Error(`${p} -> ${res.status} ${json.error}`);
    return json.data;
  } catch (error) {
    if (controller?.signal.aborted) throw new Error(`${p} timed out after ${timeoutMs}ms`);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function mainRow(processes) {
  // The main process is the Browser-type row (the untitled 2.8GB process).
  return processes.processes.find((row) => row.type === "Browser") ?? null;
}

async function sampleProcesses(label) {
  const data = await call("GET", "/processes");
  const main = mainRow(data);
  const gpu = data.processes.find((row) => row.type === "GPU");
  const tab = data.processes
    .filter((row) => row.type === "Tab" || row.type === "Renderer")
    .sort((a, b) => b.memory.workingSetMb - a.memory.workingSetMb)[0];
  return {
    label,
    at: Date.now(),
    mainWorkingSetMb: main?.memory.workingSetMb ?? null,
    mainPrivateMb: main?.memory.privateMb ?? null,
    mainNode: data.mainProcess ?? null,
    rendererWorkingSetMb: tab?.memory.workingSetMb ?? null,
    gpuWorkingSetMb: gpu?.memory.workingSetMb ?? null,
    totalWorkingSetMb: data.totals.workingSetMb,
  };
}

function fmt(v) {
  return v == null ? "n/a" : Number(v).toFixed(1);
}

function printSample(s, extra = "") {
  console.log(
    `${s.label.padEnd(14)} main ws ${fmt(s.mainWorkingSetMb).padStart(8)}  ` +
      `(node heap ${fmt(s.mainNode?.heapUsedMb).padStart(6)}, ext ${fmt(s.mainNode?.externalMb).padStart(6)})  ` +
      `renderer ${fmt(s.rendererWorkingSetMb).padStart(7)}  gpu ${fmt(s.gpuWorkingSetMb).padStart(7)}  ${extra}`,
  );
}

async function connectHeap() {
  try {
    const target = await pickPageTarget(debugPort);
    const cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send("HeapProfiler.enable");
    return cdp;
  } catch (error) {
    console.log(`(heap probe unavailable: ${error.message})`);
    return null;
  }
}

async function main() {
  const health = await fetch(`${conn.url}/health`).then((r) => r.json());
  if (!health.rendererReady) throw new Error("renderer not ready");

  const state = await call("GET", "/state");
  if (state.queueLength < 2) throw new Error(`queue too short (${state.queueLength})`);
  const localCandidates = localOnly
    ? (await call("GET", "/playback/candidates")).candidates ?? []
    : [];
  if (localOnly && localCandidates.length < 2) {
    throw new Error(`not enough local playback candidates (${localCandidates.length})`);
  }
  console.log(
    `queue=${state.queueLength} currentIndex=${state.currentIndex} switches=${switches} dwell=${dwellMs}ms ` +
      `mode=${localOnly ? `local-only candidates=${localCandidates.length}` : `stride=${step}`}\n`,
  );

  const cdp = await connectHeap();
  const samples = [];
  const diagBefore = await call("GET", "/memory/diag");
  const baseline = await sampleProcesses("baseline");
  samples.push(baseline);
  printSample(baseline);

  const base = Math.max(0, state.currentIndex);
  for (let i = 1; i <= switches; i += 1) {
    const index = localOnly
      ? localCandidates[(i - 1) % localCandidates.length].index
      : (base + i * step) % state.queueLength;
    try {
      await call("POST", "/player/playIndex", { index }, { timeoutMs: playTimeoutMs });
    } catch (error) {
      console.log(`  playIndex ${index} failed: ${error.message}`);
    }
    await sleep(dwellMs);
    const s = await sampleProcesses(`switch ${String(i).padStart(2)}`);
    samples.push(s);
    printSample(s, `idx ${index}`);
  }

  await call("POST", "/player/pause").catch(() => {});
  await sleep(1500);
  const afterRun = await sampleProcesses("after run");
  samples.push(afterRun);
  printSample(afterRun);

  // H-1 attribution: renderer GC → does MAIN memory fall?
  let afterGc = null;
  if (doGc && cdp) {
    await cdp.send("HeapProfiler.collectGarbage");
    await sleep(3000);
    afterGc = await sampleProcesses("after gc");
    samples.push(afterGc);
    printSample(afterGc);
  }

  const diagAfter = await call("GET", "/memory/diag");
  const grow = (afterRun.mainWorkingSetMb ?? 0) - (baseline.mainWorkingSetMb ?? 0);
  const gcDrop = afterGc ? (afterRun.mainWorkingSetMb ?? 0) - (afterGc.mainWorkingSetMb ?? 0) : null;

  console.log("\n== summary ==");
  console.log(`main working-set growth over ${switches} switches: ${grow.toFixed(1)} MB`);
  if (gcDrop != null) {
    console.log(
      `renderer GC → main working-set drop: ${gcDrop.toFixed(1)} MB ` +
        `(${gcDrop > Math.max(50, grow * 0.4) ? "PINNED-BY-RENDERER-HANDLES confirmed" : "no big pin — look at storage layer"})`,
    );
  }
  console.log("\nplaybackCache:", JSON.stringify(diagAfter.playbackCache));
  console.log("mediaBlobs byBackend:", JSON.stringify(diagAfter.mediaBlobs.byBackend));
  console.log("bounded caches before:", JSON.stringify(diagBefore.caches));
  console.log("bounded caches after: ", JSON.stringify(diagAfter.caches));

  if (cdp) cdp.close();
}

main().catch((error) => {
  console.error(`\n💥 ${error.message}`);
  process.exit(1);
});

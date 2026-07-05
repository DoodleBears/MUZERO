#!/usr/bin/env node
// H-1 mechanism probe (memory-leak PRD 20260705 Phase 0, Q-7): which PROCESS holds
// the bytes of renderer-created Blobs, and does releasing the handles + forcing a
// renderer GC return that memory?
//
// Controlled experiment, no app behavior involved:
//   1. sample per-process memory (control endpoint /processes)
//   2. CDP Runtime.evaluate: allocate N blobs × M bytes, hold them on globalThis
//   3. sample again → whichever process grew by ~N×M holds blob bytes
//   4. drop the references + HeapProfiler.collectGarbage
//   5. sample again → did the memory come back?
//
// Usage: node scripts/perf-blob-pinning-probe.mjs [--blobs 100] [--mb 8] [--port 39222]
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
const blobCount = Number(arg("--blobs", 100));
const blobMb = Number(arg("--mb", 8));
const debugPort = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT ?? 39222));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function processes() {
  const res = await fetch(`${conn.url}/processes`, { headers: HEADERS });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error);
  const rows = json.data.processes;
  const pick = (type) =>
    rows
      .filter((row) => row.type === type)
      .sort((a, b) => b.memory.workingSetMb - a.memory.workingSetMb)[0];
  return {
    main: pick("Browser")?.memory.workingSetMb ?? null,
    renderer: (pick("Tab") ?? pick("Renderer"))?.memory.workingSetMb ?? null,
    gpu: pick("GPU")?.memory.workingSetMb ?? null,
  };
}

function printRow(label, s) {
  console.log(
    `${label.padEnd(18)} main ${String(s.main).padStart(8)}  renderer ${String(s.renderer).padStart(8)}  gpu ${String(s.gpu).padStart(8)}`,
  );
}

const target = await pickPageTarget(debugPort);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("HeapProfiler.enable");
await cdp.send("Runtime.enable");

const evalExpr = (expression) =>
  cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });

const before = await processes();
printRow("before", before);

await evalExpr(`(() => {
  const bytes = ${blobMb} * 1024 * 1024;
  globalThis.__blobProbe = [];
  for (let i = 0; i < ${blobCount}; i += 1) {
    // Fresh random-ish payload per blob so nothing dedupes/compresses away.
    const buf = new Uint8Array(bytes);
    for (let j = 0; j < buf.length; j += 4096) buf[j] = (i + j) & 0xff;
    globalThis.__blobProbe.push(new Blob([buf]));
  }
  return globalThis.__blobProbe.length;
})()`);
await sleep(3000);
const held = await processes();
printRow(`held ${blobCount}x${blobMb}MB`, held);

await evalExpr("(() => { globalThis.__blobProbe = undefined; return true; })()");
await cdp.send("HeapProfiler.collectGarbage");
await sleep(4000);
const released = await processes();
printRow("released+gc", released);

const totalMb = blobCount * blobMb;
const mainGrew = (held.main ?? 0) - (before.main ?? 0);
const rendererGrew = (held.renderer ?? 0) - (before.renderer ?? 0);
const mainBack = (held.main ?? 0) - (released.main ?? 0);
console.log("\n== verdict ==");
console.log(`allocated ${totalMb}MB of Blobs in the renderer`);
console.log(`main grew ${mainGrew.toFixed(1)}MB, renderer grew ${rendererGrew.toFixed(1)}MB while held`);
console.log(
  mainGrew > totalMb * 0.6
    ? `→ blob bytes live in the MAIN process (H-1 lazy-GC pinning theory HOLDS)`
    : rendererGrew > totalMb * 0.6
      ? `→ blob bytes live in the RENDERER process (H-1 main-process pinning theory does NOT hold here)`
      : `→ growth is split/elsewhere — inspect manually`,
);
console.log(`after release+GC, main returned ${mainBack.toFixed(1)}MB of the growth`);
cdp.close();

// Retained-heap leak probe (companion to perf-drive's frame-cadence report). Forces GC
// before+after a switch loop via CDP on the prod-profile renderer so the delta is RETAINED
// memory (a real leak signal), not uncollected garbage that GC would reclaim.
//   1) make electron-profile            (prod build + remote-debug :39222 + control endpoint)
//   2) node scripts/perf-mem.mjs [debugPort=39222] [switches=80]
// Reports retainedDeltaMb across the loop — ~0 means no leak on the switch path.
import { readFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const port = Number(process.argv[2] ?? 39222);
const switches = Number(process.argv[3] ?? 80);
const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ctl(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await res.json()).data;
}

const target = await pickPageTarget(port);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("HeapProfiler.enable");
await cdp.send("Performance.enable");

const usedMb = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return (metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0) / 1e6;
};
const gc = async () => {
  await cdp.send("HeapProfiler.collectGarbage");
  await sleep(300);
};

const before = await ctl("GET", "/state");
const a = Math.max(0, before.currentIndex);
const b = a === 0 ? Math.min(1, before.queueLength - 1) : a - 1;

await gc();
const base = await usedMb();
for (let i = 0; i < switches; i++) {
  await ctl("POST", "/player/playIndex", { index: i % 2 === 0 ? b : a });
  await sleep(120);
}
await gc();
const after = await usedMb();

console.log(
  JSON.stringify(
    {
      queueLength: before.queueLength,
      switches,
      retainedBeforeGcMb: Number(base.toFixed(1)),
      retainedAfterGcMb: Number(after.toFixed(1)),
      retainedDeltaMb: Number((after - base).toFixed(1)),
    },
    null,
    2,
  ),
);
cdp.close();
process.exit(0);

#!/usr/bin/env node
// CDP-driven REAL drag-gesture harness (PRD 20260617-dock-swipe-switch-jank). The
// store control endpoint can only drive programmatic switches (playIndex); this
// instead synthesizes actual pointer drags via CDP `Input.dispatchMouseEvent` so the
// trace covers the WHOLE drag path — motion's drag, the dragSnapToOrigin spring, the
// cover crossfade — not just the downstream switch. Markers come through the control
// endpoint so the trace slices align with perf-drive. Usage:
//   node scripts/perf-gesture.mjs <dock|cover> [--swipes N] [--dist PX] [--dir left|right]
//     [--every MS] [--settle MS] [--steps N] [--name LABEL] [--port DBG]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { analyzeCpuProfile } from "./lib/cpuprofile-analyze.mjs";

const target = process.argv[2] || "dock";
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const swipes = Number(arg("--swipes", 8));
const dist = Number(arg("--dist", 130));
const dir = arg("--dir", "left"); // left = next, right = prev
const everyMs = Number(arg("--every", 1500));
const settleMs = Number(arg("--settle", 2500));
const steps = Number(arg("--steps", 10));
const name = arg("--name", `gesture-${target}`);
const doProfile = process.argv.includes("--profile");
const dbgPort = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT || 39222));
const SELECTOR = target === "cover" ? '[data-testid="now-cover-drag"]' : '[data-testid="dock-song-drag"]';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
async function ctl(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${p} -> ${res.status} ${json.error}`);
  return json.data;
}

// --- minimal CDP client over the page target's websocket -------------------------
async function connectCdp(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no CDP page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("cdp ws error")), { once: true });
  });
  let id = 0;
  const send = (m, params) =>
    new Promise((res) => {
      const myId = ++id;
      const h = (e) => {
        const j = JSON.parse(e.data);
        if (j.id === myId) {
          ws.removeEventListener("message", h);
          res(j.result);
        }
      };
      ws.addEventListener("message", h);
      ws.send(JSON.stringify({ id: myId, method: m, params }));
    });
  return { send, close: () => ws.close() };
}

async function centerOf(cdp, selector) {
  const { result } = await cdp.send("Runtime.evaluate", {
    expression: `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;const r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height});})()`,
    returnByValue: true,
  });
  return result.value ? JSON.parse(result.value) : null;
}

async function mouse(cdp, type, x, y, buttons) {
  await cdp.send("Input.dispatchMouseEvent", {
    type,
    x: Math.round(x),
    y: Math.round(y),
    button: "left",
    buttons,
    clickCount: type === "mouseReleased" ? 1 : type === "mousePressed" ? 1 : 0,
    pointerType: "mouse",
  });
}

async function drag(cdp, c) {
  // dist px horizontally; left = next (negative x). One move per ~frame so motion's
  // drag animates and the per-frame cost lands in the trace.
  const sign = dir === "right" ? 1 : -1;
  await mouse(cdp, "mousePressed", c.x, c.y, 1);
  for (let i = 1; i <= steps; i += 1) {
    const x = c.x + (sign * dist * i) / steps;
    await mouse(cdp, "mouseMoved", x, c.y, 1);
    await sleep(16);
  }
  await mouse(cdp, "mouseReleased", c.x + sign * dist, c.y, 0);
}

// --- frame / longtask aggregation (mirrors perf-drive) ---------------------------
const val = (e) => (Array.isArray(e.data) ? (e.data[0] ?? {}) : (e.data ?? {}));
function aggregate(entries) {
  const frames = entries.filter((e) => e.scope === "performance.frame").map(val);
  const longs = entries.filter((e) => e.scope === "performance.longtask").map(val);
  const work = (msg) =>
    entries.filter((e) => e.scope === "performance.work" && e.message === msg).map(val);
  const max = (xs) => (xs.length ? Math.max(...xs) : 0);
  const min = (xs) => (xs.length ? Math.min(...xs) : null);
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
  const stf = work("player.switch.toFrame").map((d) => d.lastMs ?? 0);
  const qf = work("queue.live.fetch");
  const fpsAvgs = frames.map((f) => f.fpsAvg).filter((x) => typeof x === "number");
  const fpsLows = frames.map((f) => f.fpsLow).filter((x) => typeof x === "number");
  return {
    frameWindows: frames.length,
    fpsAvg: mean(fpsAvgs), // mean of per-window average fps
    fpsLowMin: min(fpsLows), // worst per-window low fps (the dropped-frame floor)
    fpsLowAvg: mean(fpsLows),
    frameMaxMs: max(frames.map((f) => f.frameMaxMs ?? 0)),
    frameP99Ms: max(frames.map((f) => f.frameP99Ms ?? 0)),
    longTaskCount: longs.length,
    longTaskMaxMs: max(longs.map((l) => l.durationMs ?? 0)),
    longTaskTotalMs: Math.round(longs.reduce((s, l) => s + (l.durationMs ?? 0), 0)),
    switchToFrameMaxMs: max(stf),
    switchToFrameAvgMs: stf.length ? Math.round(stf.reduce((s, x) => s + x, 0) / stf.length) : 0,
    switchCount: stf.length,
    queueLiveFetchCount: qf.length,
  };
}

// --- run -------------------------------------------------------------------------
const cdp = await connectCdp(dbgPort);
await cdp.send("Runtime.enable", {});
const c0 = await centerOf(cdp, SELECTOR);
if (!c0) {
  console.error(`target not found: ${SELECTOR} (is the element visible / on the right tab?)`);
  process.exit(2);
}
process.stdout.write(`target ${target} @ (${Math.round(c0.x)},${Math.round(c0.y)}) ${Math.round(c0.w)}x${Math.round(c0.h)}\n`);

const state0 = await ctl("GET", "/state");
const startedAt = Date.now();
if (doProfile) {
  await cdp.send("Profiler.enable", {});
  await cdp.send("Profiler.setSamplingInterval", { interval: 120 });
  await cdp.send("Profiler.start", {});
}
await ctl("POST", "/perf/marker", { label: "scenario.start", meta: { scenario: name } });
try {
  await ctl("POST", "/renderTrace", { action: "reset" });
} catch {
  /* render-trace not wired (older build) */
}
for (let i = 0; i < swipes; i += 1) {
  const c = (await centerOf(cdp, SELECTOR)) ?? c0;
  await drag(cdp, c);
  if (i < swipes - 1) await sleep(everyMs);
}
await ctl("POST", "/perf/marker", { label: "scenario.end", meta: { scenario: name } });
let renderTrace = null;
try {
  renderTrace = (await ctl("POST", "/renderTrace", {}))?.entries ?? null;
} catch {
  /* not wired */
}
await sleep(settleMs);
let profileAnalysis = null;
if (doProfile) {
  const { profile } = await cdp.send("Profiler.stop", {});
  const dir3 = path.join(process.cwd(), ".logs", "perf-profiles");
  mkdirSync(dir3, { recursive: true });
  writeFileSync(path.join(dir3, `${name}-${startedAt}.cpuprofile`), JSON.stringify(profile));
  profileAnalysis = analyzeCpuProfile(profile, { top: 20 });
}
const dump = await ctl("POST", "/perf/trace", { since: startedAt });
const state1 = await ctl("GET", "/state");
cdp.close();

const report = {
  scenario: name,
  target,
  selector: SELECTOR,
  queueLength: state0.queueLength,
  swipes,
  dist,
  dir,
  steps,
  currentIndexFrom: state0.currentIndex,
  currentIndexTo: state1.currentIndex,
  isPlaying: state1.isPlaying,
  traceEntries: dump.count,
  ...aggregate(dump.entries),
  renderTrace,
};
const dir2 = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(dir2, { recursive: true });
writeFileSync(path.join(dir2, `${name}-${startedAt}.json`), JSON.stringify({ report }, null, 2));
console.log(JSON.stringify({ ...report, renderTrace: undefined }, null, 2));
if (renderTrace?.length) {
  console.log("\nRENDER-TRACE (surfaces that re-rendered this scenario):");
  for (const s of renderTrace)
    console.log(
      `  ${String(s.actualMs).padStart(7)}ms  ${s.commits}× (${s.updateCommits} upd)  ${s.id}` +
        (s.hiddenActualMs > 0.5 ? `   ⚠ HIDDEN ${s.hiddenActualMs}ms/${s.hiddenCommits}×` : ""),
    );
}
if (profileAnalysis) {
  console.log(`\nTOP SELF TIME (${profileAnalysis.sampleCount} samples, ${profileAnalysis.durationMs}ms):`);
  for (const e of profileAnalysis.topSelf.slice(0, 16))
    console.log(`  ${String(e.selfMs).padStart(7)}ms ${String(e.selfPct).padStart(4)}%  ${e.fn}  ${e.url}${e.line ? `:${e.line}` : ""}`);
}

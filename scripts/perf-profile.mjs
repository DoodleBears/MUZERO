#!/usr/bin/env node
// Agent self-profiling orchestrator (PRD 20260616-agent-cpu-profiling-harness). Wraps a
// CDP `Profiler` capture around a control-endpoint-driven scenario so the profile covers
// the REAL switch path, then writes a .cpuprofile (DevTools/speedscope-openable) + a
// machine-readable .analysis.json (top self/total time) the agent reads to attribute the
// diffuse switch cost. Usage:
//   node scripts/perf-profile.mjs <switch|pingpong|counted|idle> [--switches N] [--every MS] [--interval US] [--port DBG] [--name LABEL] [--top N]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";
import { analyzeCpuProfile } from "./lib/cpuprofile-analyze.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const scenario = process.argv[2] || "switch";
const switches = Number(arg("--switches", 8));
const everyMs = Number(arg("--every", 1400));
const intervalUs = Number(arg("--interval", 120));
const port = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT || 9222));
const name = arg("--name", scenario);
const top = Number(arg("--top", 25));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
async function ctl(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!json.ok) throw new Error(`${p} -> ${res.status} ${json.error}`);
  return json.data;
}

async function driveScenario() {
  await ctl("POST", "/perf/marker", { label: "profile.start", meta: { scenario: name } });
  if (scenario === "pingpong") {
    const base = (await ctl("GET", "/state")).currentIndex;
    for (let i = 0; i < switches; i += 1) {
      await ctl("POST", "/player/playIndex", { index: i % 2 === 0 ? base + 1 : base });
      if (i < switches - 1) await sleep(everyMs);
    }
  } else if (scenario === "idle") {
    await sleep(switches * everyMs);
  } else if (scenario === "search") {
    // Open ⌘F then type a query one char at a time on the live library, so the
    // profile captures the open-window burst + per-keystroke render/cover work.
    const query = arg("--query", "love");
    const typeMs = Number(arg("--type-every", 120));
    const settle = Number(arg("--settle", 2500));
    const listen = Number(arg("--listen", 3000));
    await ctl("POST", "/search", { action: "reset" });
    await ctl("POST", "/search", { action: "open" });
    await sleep(settle);
    let typed = "";
    for (const ch of [...query]) {
      typed += ch;
      await ctl("POST", "/search", { action: "type", query: typed });
      await sleep(typeMs);
    }
    await sleep(listen);
    await ctl("POST", "/search", { action: "close" });
  } else {
    for (let i = 0; i < switches; i += 1) {
      await ctl("POST", "/player/playIndex", { index: "+1" });
      if (i < switches - 1) await sleep(everyMs);
    }
  }
  await ctl("POST", "/perf/marker", { label: "profile.end", meta: { scenario: name } });
}

const target = await pickPageTarget(port, "localhost");
process.stdout.write(`profiling renderer: ${target.url}\n`);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: intervalUs });
await cdp.send("Profiler.start");

await driveScenario();

const { profile } = await cdp.send("Profiler.stop");
cdp.close();

const dir = path.join(process.cwd(), ".logs", "perf-profiles");
mkdirSync(dir, { recursive: true });
const stamp = profile.endTime; // µs clock from the profile itself (no Date.now in script land)
const cpuPath = path.join(dir, `${name}-${stamp}.cpuprofile`);
writeFileSync(cpuPath, JSON.stringify(profile));
const analysis = { scenario: name, switches, intervalUs, ...analyzeCpuProfile(profile, { top }) };
const analysisPath = path.join(dir, `${name}-${stamp}.analysis.json`);
writeFileSync(analysisPath, JSON.stringify(analysis, null, 2));

console.log(`\nsamples=${analysis.sampleCount} duration=${analysis.durationMs}ms interval≈${analysis.samplingIntervalUs}µs`);
console.log("byCategory:", JSON.stringify(analysis.byCategory));
console.log("\nTOP SELF TIME (the flame-graph leaves):");
for (const e of analysis.topSelf.slice(0, 15))
  console.log(`  ${String(e.selfMs).padStart(7)}ms ${String(e.selfPct).padStart(4)}%  ${e.fn}  ${e.url}${e.line ? ":" + e.line : ""}`);
console.log(`\ncpuprofile: ${path.relative(process.cwd(), cpuPath)}`);
console.log(`analysis:   ${path.relative(process.cwd(), analysisPath)}`);

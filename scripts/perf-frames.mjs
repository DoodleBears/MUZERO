#!/usr/bin/env node
// Frame-level perf report: combines the run's TRACE metrics (avg/low fps, frame max,
// long tasks, switch→frame) with a CPU-profile attribution of the LONGEST frames
// (what the dropped frames are actually spent on). Reads what `perf-gesture`/`perf-drive`
// already wrote to .logs (a <name>-<ts>.cpuprofile from `--profile`, and the matching
// <name>-<ts>.json report). Usage:
//   node scripts/perf-frames.mjs <name|path.cpuprofile> [--min-frame-ms 25] [--top 22]
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const input = process.argv[2];
if (!input) {
  console.error("usage: node scripts/perf-frames.mjs <name|path.cpuprofile> [--min-frame-ms N] [--top N]");
  process.exit(2);
}
const minMs = Number(arg("--min-frame-ms", 25));
const top = Number(arg("--top", 22));

const profDir = path.join(process.cwd(), ".logs", "perf-profiles");
const repDir = path.join(process.cwd(), ".logs", "perf-reports");

// Resolve the cpuprofile: explicit path, or newest matching the name prefix.
function resolveProfile() {
  if (input.endsWith(".cpuprofile")) return input;
  const matches = readdirSync(profDir)
    .filter((f) => f.startsWith(`${input}-`) && f.endsWith(".cpuprofile"))
    .sort();
  if (!matches.length) throw new Error(`no cpuprofile for "${input}" in ${profDir}`);
  return path.join(profDir, matches[matches.length - 1]);
}
const profPath = resolveProfile();
const stamp = path.basename(profPath).replace(/\.cpuprofile$/, "").replace(/^.*-(\d+)$/, "$1");
const name = path.basename(profPath).replace(/-\d+\.cpuprofile$/, "");

// Matching trace report (same name + stamp), if present.
let report = null;
try {
  const repPath = path.join(repDir, `${name}-${stamp}.json`);
  report = JSON.parse(readFileSync(repPath, "utf8")).report;
} catch {
  /* no sibling report — CPU attribution only */
}

const p = JSON.parse(readFileSync(profPath, "utf8"));
const nodeById = new Map(p.nodes.map((n) => [n.id, n]));
const fnName = (id) => nodeById.get(id)?.callFrame.functionName || "";
const isIdle = (id) => {
  const fn = fnName(id);
  return fn === "(idle)" || fn === "(program)" || fn === "(garbage collector)";
};
const label = (id) => {
  const cf = nodeById.get(id)?.callFrame;
  if (!cf) return "?";
  const fn = cf.functionName || "(anonymous)";
  const file = (cf.url || "").replace(/.*\//, "").replace(/\?.*/, "");
  return file ? `${fn} @ ${file}:${cf.lineNumber + 1}` : fn;
};

// Group consecutive non-idle samples into busy windows (≈ frames over budget).
const windows = [];
let cur = null;
for (let i = 0; i < p.samples.length; i += 1) {
  const id = p.samples[i];
  const dtMs = (p.timeDeltas[i] || 0) / 1000;
  if (isIdle(id)) {
    if (cur && cur.ms >= minMs) windows.push(cur);
    cur = null;
    continue;
  }
  if (!cur) cur = { ms: 0, byFn: new Map() };
  cur.ms += dtMs;
  cur.byFn.set(id, (cur.byFn.get(id) || 0) + dtMs);
}
if (cur && cur.ms >= minMs) windows.push(cur);
windows.sort((a, b) => b.ms - a.ms);

console.log(`# perf-frames: ${name} (${path.relative(process.cwd(), profPath)})\n`);
if (report) {
  console.log("TRACE (whole run):");
  const r = report;
  console.log(`  fps      avg ${r.fpsAvg ?? "—"}   lowAvg ${r.fpsLowAvg ?? "—"}   lowMin ${r.fpsLowMin ?? "—"}`);
  console.log(`  frame    max ${Math.round(r.frameMaxMs ?? 0)}ms   p99 ${Math.round(r.frameP99Ms ?? 0)}ms   windows ${r.frameWindows ?? "—"}`);
  console.log(`  longtask count ${r.longTaskCount ?? 0}   total ${r.longTaskTotalMs ?? 0}ms   max ${Math.round(r.longTaskMaxMs ?? 0)}ms`);
  if (r.switchCount != null)
    console.log(`  switch→frame avg ${r.switchToFrameAvgMs}ms   max ${Math.round(r.switchToFrameMaxMs)}ms   (${r.switchCount} switches)`);
  if (r.queueLiveFetchCount != null) console.log(`  queue.live.fetch ${r.queueLiveFetchCount}`);
  console.log("");
}
const byCat = {};
for (let i = 0; i < p.samples.length; i += 1) {
  const fn = fnName(p.samples[i]);
  const cat = fn === "(idle)" ? "idle" : fn === "(program)" ? "program" : fn === "(garbage collector)" ? "gc" : "script";
  byCat[cat] = (byCat[cat] || 0) + (p.timeDeltas[i] || 0) / 1000;
}
console.log(`CPU byCategory(ms): ${Object.entries(byCat).map(([k, v]) => `${k} ${Math.round(v)}`).join("  ")}`);
console.log(`busy frames ≥${minMs}ms: ${windows.length}; longest ${windows.slice(0, 8).map((w) => Math.round(w.ms)).join(", ")} ms\n`);

const topN = Math.min(8, windows.length);
const agg = new Map();
let total = 0;
for (const w of windows.slice(0, topN)) {
  total += w.ms;
  for (const [id, ms] of w.byFn) agg.set(label(id), (agg.get(label(id)) || 0) + ms);
}
console.log(`=== self-time inside the ${topN} longest frames (Σ ${Math.round(total)}ms) — what the dropped frames are made of ===`);
for (const [fn, ms] of [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)) {
  console.log(`  ${String(Math.round(ms)).padStart(5)}ms ${String(Math.round((ms / total) * 100)).padStart(3)}%  ${fn}`);
}

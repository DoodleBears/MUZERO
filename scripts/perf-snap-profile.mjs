// Capture a CPU profile of the CURRENT renderer state for N seconds and print top self-time
// functions (what the busy time is actually spent on). For attributing steady-state storms
// (e.g. cover-derivative disk I/O) that the scenario-driven perf-profile.mjs doesn't target.
//   node scripts/perf-snap-profile.mjs [seconds=8] [port=39222]
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const seconds = Number(process.argv[2] ?? 8);
const port = Number(process.argv[3] ?? 39222);
const target = await pickPageTarget(port);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await new Promise((r) => setTimeout(r, seconds * 1000));
const { profile } = await cdp.send("Profiler.stop");
cdp.close();

const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
const label = (id) => {
  const cf = nodeById.get(id)?.callFrame; if (!cf) return "?";
  const fn = cf.functionName || "(anonymous)";
  const file = (cf.url || "").replace(/.*\//, "").replace(/\?.*/, "");
  return file ? `${fn} @ ${file}:${cf.lineNumber + 1}` : fn;
};
const self = new Map(); const byCat = {};
for (let i = 0; i < profile.samples.length; i++) {
  const id = profile.samples[i]; const dt = (profile.timeDeltas[i] || 0) / 1000;
  const fn = nodeById.get(id)?.callFrame.functionName || "";
  const cat = fn === "(idle)" ? "idle" : fn === "(program)" ? "program" : fn === "(garbage collector)" ? "gc" : "script";
  byCat[cat] = (byCat[cat] || 0) + dt;
  if (cat === "script" || cat === "gc") self.set(label(id), (self.get(label(id)) || 0) + dt);
}
mkdirSync(path.join(process.cwd(), ".logs", "perf-profiles"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(path.join(process.cwd(), ".logs", "perf-profiles", `snap-${stamp}.cpuprofile`), JSON.stringify(profile));
console.log(`CPU byCategory(ms): ${Object.entries(byCat).map(([k, v]) => `${k} ${Math.round(v)}`).join("  ")}`);
console.log(`=== top self-time (script+gc) over ${seconds}s ===`);
for (const [fn, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
  console.log(`  ${String(Math.round(ms)).padStart(5)}ms  ${fn}`);
}

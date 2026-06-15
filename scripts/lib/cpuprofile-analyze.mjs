// .cpuprofile analyzer (PRD 20260616-agent-cpu-profiling-harness). Turns a CDP
// Profiler.stop `Profile` (nodes/samples/timeDeltas) into machine-readable rankings an
// agent can read directly: top SELF time (the widest flame-graph leaves) and top TOTAL
// (inclusive) time, plus a coarse category split. Output unit is milliseconds.

const SPECIAL = new Set(["(root)", "(program)", "(idle)", "(garbage collector)"]);

/** Trim a script url to something readable (prefer the repo-relative src/ path). */
function shortUrl(url) {
  if (!url) return "";
  const srcIdx = url.indexOf("/src/");
  if (srcIdx >= 0) return url.slice(srcIdx + 1).replace(/[?#].*$/, "");
  const nm = url.lastIndexOf("/node_modules/");
  if (nm >= 0) return url.slice(nm + 14).replace(/[?#].*$/, "");
  try {
    return new URL(url).pathname.split("/").slice(-1)[0] || url;
  } catch {
    return url;
  }
}

function categoryOf(frame) {
  const fn = frame.functionName;
  if (fn === "(idle)") return "idle";
  if (fn === "(garbage collector)") return "gc";
  if (fn === "(program)") return "program";
  if (fn === "(root)") return "root";
  const u = frame.url || "";
  if (/react-dom|\bscheduler\b|react\.|react_/.test(u)) return "react";
  if (u) return "script";
  return "system";
}

/**
 * @param {{nodes:Array,samples:number[],timeDeltas:number[],startTime?:number,endTime?:number}} profile
 * @param {{top?:number}} opts
 */
export function analyzeCpuProfile(profile, opts = {}) {
  const top = opts.top ?? 25;
  const { nodes = [], samples = [], timeDeltas = [] } = profile;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Self time: attribute each sample's interval (µs) to the sampled node.
  const selfUs = new Map();
  let totalUs = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const dt = Math.max(0, timeDeltas[i] ?? 0);
    totalUs += dt;
    selfUs.set(samples[i], (selfUs.get(samples[i]) ?? 0) + dt);
  }

  // Inclusive (total) time per node = self + children, via post-order over the tree.
  const totalById = new Map();
  function inclusive(id) {
    if (totalById.has(id)) return totalById.get(id);
    const node = byId.get(id);
    if (!node) return 0;
    let sum = selfUs.get(id) ?? 0;
    for (const childId of node.children ?? []) sum += inclusive(childId);
    totalById.set(id, sum);
    return sum;
  }
  for (const n of nodes) inclusive(n.id);

  // Aggregate by function identity (fn + url:line) — a function recurs across many nodes.
  const selfByFn = new Map();
  const totalByFn = new Map();
  const byCategory = {};
  const keyOf = (f) => `${f.functionName || "(anonymous)"}|${shortUrl(f.url)}|${f.lineNumber ?? 0}`;
  for (const n of nodes) {
    const f = n.callFrame;
    const k = keyOf(f);
    const self = selfUs.get(n.id) ?? 0;
    const tot = totalById.get(n.id) ?? 0;
    if (!selfByFn.has(k)) {
      selfByFn.set(k, { fn: f.functionName || "(anonymous)", url: shortUrl(f.url), line: f.lineNumber ?? 0, us: 0 });
      totalByFn.set(k, { fn: f.functionName || "(anonymous)", url: shortUrl(f.url), line: f.lineNumber ?? 0, us: 0 });
    }
    selfByFn.get(k).us += self;
    // total is summed at function level too (approximate for recursion; fine for ranking)
    totalByFn.get(k).us += tot;
    const cat = categoryOf(f);
    if (cat !== "root") byCategory[cat] = (byCategory[cat] ?? 0) + self;
  }

  const ms = (us) => Math.round((us / 1000) * 10) / 10;
  const pct = (us) => (totalUs > 0 ? Math.round((us / totalUs) * 1000) / 10 : 0);
  const rankSelf = [...selfByFn.values()]
    .filter((e) => !SPECIAL.has(e.fn) || e.fn === "(garbage collector)" || e.fn === "(program)")
    .sort((a, b) => b.us - a.us)
    .slice(0, top)
    .map((e) => ({ fn: e.fn, url: e.url, line: e.line, selfMs: ms(e.us), selfPct: pct(e.us) }));
  const rankTotal = [...totalByFn.values()]
    .filter((e) => e.fn !== "(root)")
    .sort((a, b) => b.us - a.us)
    .slice(0, top)
    .map((e) => ({ fn: e.fn, url: e.url, line: e.line, totalMs: ms(e.us), totalPct: pct(e.us) }));

  const catMs = {};
  for (const [k, v] of Object.entries(byCategory)) catMs[k] = ms(v);

  return {
    sampleCount: samples.length,
    durationMs: ms(totalUs),
    samplingIntervalUs: samples.length ? Math.round(totalUs / samples.length) : 0,
    byCategory: catMs,
    topSelf: rankSelf,
    topTotal: rankTotal,
  };
}

// E2E video-playback resource gate (CPU / GPU / disk read+write / memory), playing vs paused.
// Plays a specific kind:"video" track via the dev control endpoint + CDP, settles past the
// cover-derivative pass, then samples steady-state. Used to record per-phase perf deltas for
// PRD docs/prd/desktop/20260623-muzero-playback-resource-optimization-prd.
//
//   relaunch harness first (throttling OFF), then:
//   node scripts/perf-video.mjs [trackId] [--label baseline] [--port 39222] [--settle 14] [--samples 6]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const arg = (n, d) => { const i = process.argv.indexOf(n); return i === -1 ? d : process.argv[i + 1]; };
const DEFAULT_TRACK = "trk_9a3940f1-8c6d-4af5-99c6-efb97c405773"; // アイドル / YOASOBI (video MV)
const trackId = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_TRACK;
const label = arg("--label", "run");
const port = Number(arg("--port", 39222));
const settleSec = Number(arg("--settle", 14));
const samples = Number(arg("--samples", 6));

const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const H = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ctl = async (m, route, body) => {
  const r = await fetch(`${conn.url}${route}`, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `${m} ${route} ${r.status}`);
  return j.data;
};

const cores = await new Promise((res) => {
  const ps = spawn("powershell.exe", ["-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).NumberOfLogicalProcessors"], { windowsHide: true });
  let o = ""; ps.stdout.on("data", (d) => (o += d)); ps.on("close", () => res(Number(o.trim()) || 8));
});

function cim() {
  return new Promise((res, rej) => {
    const script =
      "$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.IDProcess -ne 0 } | Select-Object IDProcess,PercentProcessorTime,IOReadBytesPersec,IOWriteBytesPersec;" +
      "$g = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Select-Object Name,UtilizationPercentage;" +
      "ConvertTo-Json -Compress @{ proc=$p; gpu=$g }";
    const ps = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true });
    let o = "", e = ""; ps.stdout.on("data", (d) => (o += d)); ps.stderr.on("data", (d) => (e += d));
    ps.on("close", (c) => { if (c !== 0) return rej(new Error(e.slice(0, 200))); try { res(JSON.parse(o)); } catch (err) { rej(err); } });
  });
}

async function measure(state) {
  const pidType = new Map();
  for (const p of (await ctl("GET", "/processes")).processes) pidType.set(Number(p.pid), p.type);
  const ticks = [];
  for (let i = 0; i < samples; i++) {
    const snap = await cim();
    const procRows = Array.isArray(snap.proc) ? snap.proc : [snap.proc];
    const gpuRows = snap.gpu ? (Array.isArray(snap.gpu) ? snap.gpu : [snap.gpu]) : [];
    let cpu = 0, read = 0, write = 0;
    for (const r of procRows) {
      if (!pidType.has(Number(r.IDProcess))) continue;
      cpu += (Number(r.PercentProcessorTime) || 0) / cores;
      read += (Number(r.IOReadBytesPersec) || 0) / 1048576;
      write += (Number(r.IOWriteBytesPersec) || 0) / 1048576;
    }
    let gpu3d = 0, gpuVid = 0;
    for (const g of gpuRows) {
      const m = /pid_(\d+)_.*engtype_([A-Za-z0-9]+)/.exec(g.Name || "");
      if (!m || !pidType.has(Number(m[1]))) continue;
      const u = Number(g.UtilizationPercentage) || 0;
      if (m[2] === "3D") gpu3d += u; else if (/Video/i.test(m[2])) gpuVid += u;
    }
    ticks.push({ cpu, read, write, gpu3d, gpuVid });
    if (i < samples - 1) await sleep(1000);
  }
  const proc = await ctl("GET", "/processes");
  const gpuProc = proc.processes.filter((p) => p.type === "GPU");
  const avg = (k) => round(ticks.reduce((s, t) => s + t[k], 0) / ticks.length);
  const peak = (k) => round(Math.max(...ticks.map((t) => t[k])));
  return {
    state,
    cpuPct: avg("cpu"), gpu3dPct: avg("gpu3d"), gpuVideoPct: avg("gpuVid"),
    readMbps: avg("read"), readPeakMbps: peak("read"), writeMbps: avg("write"),
    totalWorkingSetMb: round(proc.totals.workingSetMb), totalPrivateMb: round(proc.totals.privateMb),
    gpuProcPrivateMb: round(gpuProc.reduce((s, p) => s + p.memory.privateMb, 0)),
  };
}
const round = (v) => Math.round(v * 10) / 10;

// ── look up the track's set + play it ──
const target = await pickPageTarget(port);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
const lookup = `(async () => { const o=(n)=>new Promise((s,j)=>{const r=indexedDB.open(n);r.onsuccess=()=>s(r.result);r.onerror=()=>j(r.error)});
  const g=(st,k)=>new Promise((s,j)=>{const r=st.get(k);r.onsuccess=()=>s(r.result);r.onerror=()=>j(r.error)});
  const db=await o('muzero-db'); const t=await g(db.transaction('tracks','readonly').objectStore('tracks'), ${JSON.stringify(trackId)});
  return t?JSON.stringify({sessionId:t.sessionId,title:t.title,kind:t.kind}):'null'; })()`;
const { result } = await cdp.send("Runtime.evaluate", { expression: lookup, awaitPromise: true, returnByValue: true });
cdp.close();
const meta = JSON.parse(result.value);
if (!meta) throw new Error(`track ${trackId} not found`);
console.log(`[${label}] track: ${meta.title} (kind=${meta.kind})`);
await ctl("POST", "/playback/playInSet", { setId: meta.sessionId, trackId });

// settle past cover-derivative + first frames
for (let i = 0; i < settleSec; i++) { await sleep(1000); }
const playing = await measure("playing");
await ctl("POST", "/player/pause", {});
await sleep(7000); // let any cover-derivative / warmup churn settle so paused isolates decode
const paused = await measure("paused");

const report = { capturedAt: new Date().toISOString(), label, trackId, title: meta.title, kind: meta.kind, cores, settleSec, samples, playing, paused };
const outDir = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(outDir, { recursive: true });
const stamp = report.capturedAt.replace(/[:.]/g, "-");
writeFileSync(path.join(outDir, `video-${label}-${stamp}.json`), JSON.stringify(report, null, 2));

const row = (s) => `  ${s.state.padEnd(8)} cpu=${s.cpuPct.toFixed(1).padStart(5)}%  gpu3d=${s.gpu3dPct.toFixed(1).padStart(5)}%  gpuVid=${s.gpuVideoPct.toFixed(1).padStart(5)}%  read=${s.readMbps.toFixed(1).padStart(6)} (peak ${s.readPeakMbps}) write=${s.writeMbps.toFixed(1).padStart(5)} MB/s  ws=${s.totalWorkingSetMb}MB gpuPriv=${s.gpuProcPrivateMb}MB`;
console.log(`\n=== [${label}] ${meta.title} ===`);
console.log(row(playing));
console.log(row(paused));
console.log(`wrote .logs/perf-reports/video-${label}-${stamp}.json`);

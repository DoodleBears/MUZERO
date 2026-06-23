// Per-process RESOURCE harness (CPU / Memory / Disk I/O) for Electron profile builds.
//   1) pnpm electron:profile          (prod renderer + control endpoint + debug port)
//   2) node scripts/perf-resource.mjs [--play-seconds 8] [--idle-seconds 5] [--samples 4]
//
// Why this exists: app.getAppMetrics() (the existing GET /processes route) gives per-process
// CPU% + working/private MB, but NO disk I/O. The field anomaly we're chasing is ~108 MB/s
// disk while PLAYING vs ~12 MB/s while PAUSED, which app metrics can't see. So we join:
//   - GET /processes               → pid → {type, cpu%, workingSet/private MB}   (Electron)
//   - Win32_PerfFormattedData_PerfProc_Process by IDProcess → per-PID IO bytes/s (Windows)
//
// CIM is used instead of Get-Counter because Get-Counter's English counter PATHS
// ('\Process(*)\IO Read Bytes/sec') are LOCALIZED and fail on a zh/ja/ko Windows; the
// Win32_PerfFormattedData_* class + property names are stable across locales.
//
// IO bytes/s here is file+network+device (the OS "IO Data Bytes" family). During steady
// playback MUZERO's network is ~0 (download-before-play), so IO ≈ disk for our scenario.
//
// Output: a paused-vs-playing table per process TYPE + a JSON report under
// .logs/perf-reports/resource-<ts>.json. Pure measurement — no app code is touched.
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const PLAY_SECONDS = Number(arg("--play-seconds", 8));
const IDLE_SECONDS = Number(arg("--idle-seconds", 5));
const SAMPLES = Math.max(2, Number(arg("--samples", 4)));

const conn = JSON.parse(
  readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"),
);
const headers = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ctl(method, route, body) {
  const response = await fetch(`${conn.url}${route}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `${method} ${route} failed: ${response.status}`);
  }
  return payload.data;
}

/** One snapshot of every Windows process's formatted IO rates, keyed by PID. */
function diskByPid() {
  return new Promise((resolve, reject) => {
    const ps = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        // IODataBytesPersec = read+write+other; split out read/write too. Formatted = per-sec rate.
        "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |" +
          " Where-Object { $_.IDProcess -ne 0 } |" +
          " Select-Object IDProcess,IODataBytesPersec,IOReadBytesPersec,IOWriteBytesPersec |" +
          " ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    );
    let out = "";
    let err = "";
    ps.stdout.on("data", (d) => (out += d));
    ps.stderr.on("data", (d) => (err += d));
    ps.on("error", reject);
    ps.on("close", (code) => {
      if (code !== 0) return reject(new Error(`powershell exited ${code}: ${err.slice(0, 300)}`));
      try {
        const rows = JSON.parse(out || "[]");
        const list = Array.isArray(rows) ? rows : [rows];
        const map = new Map();
        for (const r of list) {
          map.set(Number(r.IDProcess), {
            ioBps: Number(r.IODataBytesPersec) || 0,
            readBps: Number(r.IOReadBytesPersec) || 0,
            writeBps: Number(r.IOWriteBytesPersec) || 0,
          });
        }
        resolve(map);
      } catch (parseErr) {
        reject(new Error(`parse CIM JSON failed: ${parseErr.message}; raw=${out.slice(0, 200)}`));
      }
    });
  });
}

const MB = 1024 * 1024;

/**
 * Average resource use over `SAMPLES` ticks (~1s apart) in the current player state.
 * Joins Electron /processes (cpu+mem, by pid) with Windows CIM disk (by pid), folds to
 * per-TYPE totals (Browser / GPU / Renderer|Tab / Utility / total).
 */
async function measure(label) {
  const ticks = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const [procs, disk] = await Promise.all([ctl("GET", "/processes"), diskByPid()]);
    const rows = procs.processes.map((p) => {
      const io = disk.get(p.pid) || { ioBps: 0, readBps: 0, writeBps: 0 };
      return {
        pid: p.pid,
        type: p.type || "unknown",
        name: p.name || p.serviceName || "",
        cpu: p.cpuPercent || 0,
        wsMb: p.memory.workingSetMb || 0,
        privMb: p.memory.privateMb || 0,
        ioMbps: io.ioBps / MB,
        readMbps: io.readBps / MB,
        writeMbps: io.writeBps / MB,
      };
    });
    ticks.push(rows);
    if (i < SAMPLES - 1) await sleep(1000);
  }
  return foldTicks(label, ticks);
}

function foldTicks(label, ticks) {
  // Sum-by-type within a tick, then average the per-type sums across ticks.
  const perTickByType = ticks.map((rows) => {
    const acc = {};
    for (const r of rows) {
      const type = normalizeType(r.type);
      const cur = (acc[type] ??= { cpu: 0, wsMb: 0, privMb: 0, ioMbps: 0, readMbps: 0, writeMbps: 0, count: 0 });
      cur.cpu += r.cpu;
      cur.wsMb += r.wsMb;
      cur.privMb += r.privMb;
      cur.ioMbps += r.ioMbps;
      cur.readMbps += r.readMbps;
      cur.writeMbps += r.writeMbps;
      cur.count += 1;
    }
    return acc;
  });
  const types = new Set(perTickByType.flatMap((t) => Object.keys(t)));
  const byType = {};
  for (const type of types) {
    const present = perTickByType.filter((t) => t[type]);
    byType[type] = avgOf(present.map((t) => t[type]));
  }
  const totalTicks = ticks.map((rows) => ({
    cpu: sum(rows, "cpu"),
    wsMb: sum(rows, "wsMb"),
    privMb: sum(rows, "privMb"),
    ioMbps: sum(rows, "ioMbps"),
    readMbps: sum(rows, "readMbps"),
    writeMbps: sum(rows, "writeMbps"),
  }));
  return { label, byType, total: avgOf(totalTicks), peakIoMbps: round(Math.max(...totalTicks.map((t) => t.ioMbps))) };
}

function avgOf(objs) {
  const out = {};
  if (!objs.length) return out;
  for (const key of Object.keys(objs[0])) {
    if (key === "count") {
      out.count = Math.round(objs.reduce((s, o) => s + (o.count || 0), 0) / objs.length);
    } else {
      out[key] = round(objs.reduce((s, o) => s + (o[key] || 0), 0) / objs.length);
    }
  }
  return out;
}

function sum(rows, key) {
  return rows.reduce((s, r) => s + (r[key] || 0), 0);
}

function normalizeType(type) {
  // app.getAppMetrics types: Browser, GPU, Tab (renderer), Utility, Zygote, ...
  if (type === "Tab") return "Renderer";
  return type;
}

function round(v) {
  return Math.round(v * 10) / 10;
}

function fmt(v) {
  return v == null ? "—" : Number(v).toFixed(1);
}

function printState(s) {
  console.log(`\n## ${s.label}`);
  console.log("type          cpu%    wsMB    privMB   io MB/s   read MB/s  write MB/s");
  console.log("-----------------------------------------------------------------------");
  const order = ["Browser", "GPU", "Renderer", "Utility"];
  const keys = [...new Set([...order, ...Object.keys(s.byType)])].filter((k) => s.byType[k]);
  for (const k of keys) {
    const t = s.byType[k];
    console.log(
      [
        String(k).padEnd(12),
        fmt(t.cpu).padStart(6),
        fmt(t.wsMb).padStart(8),
        fmt(t.privMb).padStart(8),
        fmt(t.ioMbps).padStart(9),
        fmt(t.readMbps).padStart(10),
        fmt(t.writeMbps).padStart(10),
      ].join(" "),
    );
  }
  const tot = s.total;
  console.log("-----------------------------------------------------------------------");
  console.log(
    [
      "TOTAL".padEnd(12),
      fmt(tot.cpu).padStart(6),
      fmt(tot.wsMb).padStart(8),
      fmt(tot.privMb).padStart(8),
      fmt(tot.ioMbps).padStart(9),
      fmt(tot.readMbps).padStart(10),
      fmt(tot.writeMbps).padStart(10),
    ].join(" "),
  );
  console.log(`(peak total io ${fmt(s.peakIoMbps)} MB/s over ${SAMPLES} samples)`);
}

// ── scenario: idle/paused baseline → play → playing measurement ──────────────────
const state0 = await ctl("GET", "/state");
let seeded = false;
if ((state0.queueLength ?? 0) <= 0) {
  await ctl("POST", "/seed/example", {});
  seeded = true;
  await sleep(1200);
}
// Ensure a clean PAUSED baseline first.
try {
  await ctl("POST", "/player/pause", {});
} catch {
  /* already paused */
}
await sleep(1500);
const paused = await measure("paused");

// Play the current track and let warmup/caching settle before sampling steady state.
const cur = await ctl("GET", "/state");
const index = Math.max(0, cur.currentIndex ?? 0);
await ctl("POST", "/player/playIndex", { index });
await sleep(Math.max(2000, PLAY_SECONDS * 250)); // settle (download/warmup/first frames)
const playing = await measure("playing");

await ctl("POST", "/player/pause", {}).catch(() => {});

const report = {
  capturedAt: new Date().toISOString(),
  scenario: { playSeconds: PLAY_SECONDS, idleSeconds: IDLE_SECONDS, samples: SAMPLES, seeded },
  state: { queueLength: cur.queueLength, currentIndex: index, isVideo: cur.currentKind ?? null },
  paused,
  playing,
  delta: {
    cpu: round((playing.total.cpu || 0) - (paused.total.cpu || 0)),
    wsMb: round((playing.total.wsMb || 0) - (paused.total.wsMb || 0)),
    ioMbps: round((playing.total.ioMbps || 0) - (paused.total.ioMbps || 0)),
  },
};

printState(paused);
printState(playing);
console.log("\n## delta (playing − paused)");
console.log(`cpu ${fmt(report.delta.cpu)}%   workingSet ${fmt(report.delta.wsMb)} MB   io ${fmt(report.delta.ioMbps)} MB/s`);

const outDir = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(outDir, { recursive: true });
const stamp = report.capturedAt.replace(/[:.]/g, "-");
const outPath = path.join(outDir, `resource-${stamp}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`\nwrote ${path.relative(process.cwd(), outPath)}${seeded ? " (seeded example library)" : ""}`);

#!/usr/bin/env node
// One-off README media capture: drives the running Electron app (dev control endpoint)
// into each showcase surface and grabs PNG screenshots + GIF clips via CDP, writing them
// to docs/media/. Not part of the product — a docs tool. Reuses the same zero-dep CDP
// client + control endpoint the perf harness uses.
//   unset ELECTRON_RUN_AS_NODE; MUZERO_REMOTE_DEBUG_PORT=39222 node scripts/capture-readme-media.mjs [only]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "media");
const TMP = path.join(ROOT, ".logs", "media-frames");
const PORT = Number(process.env.MUZERO_REMOTE_DEBUG_PORT || 39222);
const only = process.argv[2]; // optional: capture just one surface by name
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

const conn = JSON.parse(readFileSync(path.join(ROOT, ".logs", "perf-control.json"), "utf8"));
const H = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
async function ctl(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, {
    method,
    headers: H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${p} -> ${res.status} ${json.error}`);
  return json.data;
}

const target = await pickPageTarget(PORT, "localhost");
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const ev = async (e) =>
  (await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;
// Awaitable eval (for IndexedDB reads).
const evp = async (e) => {
  const r = await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};

// Activate the biggest set and return the queue index of a track that has cached synced
// lyrics (for the lyrics-mode showcase). Returns -1 if none — caller falls back gracefully.
async function findSyncedLyricsIndex() {
  const { sessions } = await ctl("GET", "/sessions");
  const biggest = sessions?.find((s) => s.trackCount > 0);
  if (!biggest) return -1;
  await ctl("POST", "/player/setActiveSession", { sessionId: biggest.id });
  await sleep(1400);
  const raw = await evp(`(async()=>{
    const db=await new Promise(res=>{const r=indexedDB.open('muzero-db');r.onsuccess=()=>res(r.result);});
    const all=(s)=>new Promise((res,rej)=>{const tx=db.transaction(s,'readonly');const rq=tx.objectStore(s).getAll();rq.onsuccess=()=>res(rq.result);rq.onerror=()=>rej(rq.error);});
    const get=(s,k)=>new Promise(res=>{const tx=db.transaction(s,'readonly');const rq=tx.objectStore(s).get(k);rq.onsuccess=()=>res(rq.result);});
    const pq=(await all('playQueue'))[0]; const entries=pq?.entries||[];
    const lyrics=await all('lyrics');
    const info=new Map();
    for(const r of lyrics){ if(r.synced&&r.synced.length>3&&r.status!=='instrumental') info.set(r.trackId,{tr:!!(r.translation&&r.translation.length)}); }
    // Prefer a track with BOTH cover art and a translation (prettiest lyrics shot).
    let best=-1, bestScore=-1;
    for(let i=0;i<entries.length && i<2000;i++){ const id=entries[i].trackId||entries[i].id; const li=info.get(id); if(!li) continue;
      const tk=await get('tracks',id); const hasCover=!!(tk&&(tk.coverBlobId||tk.coverThumbhash));
      const score=(hasCover?2:0)+(li.tr?1:0);
      if(score>bestScore){ bestScore=score; best=i; if(score===3) break; } }
    return best;
  })()`);
  return Number(raw);
}

const dims = JSON.parse(await ev(`JSON.stringify({w:innerWidth,h:innerHeight,dpr:devicePixelRatio})`));
process.stdout.write(`renderer ${target.url}  viewport ${dims.w}x${dims.h} @${dims.dpr}x\n`);

async function shot(name) {
  const r = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(r.data, "base64"));
  process.stdout.write(`  PNG  ${path.relative(ROOT, file)}\n`);
}

// Viewport rect of the first element matching `selector` (CSS px), or null.
async function rectOf(selector) {
  const raw = await ev(
    `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;` +
      `const b=el.getBoundingClientRect();return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`,
  );
  return raw ? JSON.parse(raw) : null;
}

// Click the centre of an element via synthesized mouse events (settings sidebar items).
async function clickSel(selector) {
  const box = await rectOf(selector);
  if (!box) throw new Error(`selector not found: ${selector}`);
  const x = box.x + box.w / 2;
  const y = box.y + box.h / 2;
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// Simulate a touchscreen swipe (framer-motion drag="x" reads the synthesized pointer
// stream) — `dx` < 0 swipes left = next track. Drives the real coverflow gesture.
async function touchSwipe(cx, cy, dx, { steps = 14, holdMs = 14 } = {}) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: cx + (dx * i) / steps, y: cy }],
    });
    await sleep(holdMs);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// Record a GIF by collecting CDP screencast frames for `durationMs`, then assembling with
// ffmpeg through a 2-pass palette (color-capped, dithered) so the README stays light.
// `everyNth` subsamples at the source; `fps`/`maxWidth`/`colors` bound the output size.
async function gif(name, { durationMs = 3000, maxWidth = 680, fps = 13, everyNth = 3, colors = 128, drive } = {}) {
  const frames = [];
  const onFrame = (p) => {
    frames.push(Buffer.from(p.data, "base64"));
    cdp.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  };
  cdp.on("Page.screencastFrame", onFrame);
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 80,
    everyNthFrame: everyNth,
    maxWidth: Math.round(maxWidth * dims.dpr),
    maxHeight: Math.round(maxWidth * dims.dpr * 2),
  });
  const driver = drive ? drive() : sleep(durationMs);
  await Promise.all([driver, sleep(durationMs)]);
  await cdp.send("Page.stopScreencast");
  await sleep(150); // drain trailing frames

  if (frames.length < 2) {
    process.stdout.write(`  GIF  ${name}: only ${frames.length} frames — skipped\n`);
    return;
  }
  const dir = path.join(TMP, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  frames.forEach((b, i) => writeFileSync(path.join(dir, `f-${String(i).padStart(4, "0")}.jpg`), b));
  const palette = path.join(dir, "palette.png");
  const out = path.join(OUT, `${name}.gif`);
  const vf = `fps=${fps},scale=${maxWidth}:-1:flags=lanczos`;
  const run = (args) => spawnSync("ffmpeg", args, { stdio: "ignore" });
  run(["-y", "-i", path.join(dir, "f-%04d.jpg"), "-vf", `${vf},palettegen=max_colors=${colors}:stats_mode=diff`, palette]);
  run(["-y", "-i", path.join(dir, "f-%04d.jpg"), "-i", palette, "-lavfi", `${vf} [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=4`, out]);
  rmSync(dir, { recursive: true, force: true });
  process.stdout.write(`  GIF  ${path.relative(ROOT, out)}  (${frames.length} frames @ ${fps}fps, ${maxWidth}px)\n`);
}

const want = (n) => !only || only === n;

// ---- baseline visual state: dark theme, immersive flow + spectrum bars, cover stage ----
await ctl("POST", "/settings", { theme: "dark", flowEnabled: true, visualizerStyle: "bars", visualizerAsBackground: true });
await ctl("POST", "/nav/tab", { tab: "now" });
await ctl("POST", "/player/setDisplayMode", { mode: "cover" });
await ctl("POST", "/player/playIndex", { index: 42 });
await ctl("POST", "/player/play", {}).catch(() => {});
await sleep(1400);

// 1) Now Playing — immersive cover stage, flow background + spectrum animating.
if (want("now-playing")) {
  await gif("now-playing", { durationMs: 2800, maxWidth: 720, fps: 14, everyNth: 3 });
}

// 2) Visualizer & lyrics — cycle the visualizer styles, then flip into lyrics mode
//    (on a track with cached synced lyrics so the lyrics surface actually renders).
if (want("visualizer")) {
  const lyricsIndex = await findSyncedLyricsIndex();
  await ctl("POST", "/nav/tab", { tab: "now" });
  await ctl("POST", "/player/setDisplayMode", { mode: "cover" });
  if (lyricsIndex >= 0) await ctl("POST", "/player/playIndex", { index: lyricsIndex });
  await ctl("POST", "/settings", {
    flowEnabled: false,
    visualizerAsBackground: true,
    visualizerStyle: "bars",
    nowPlayingRightRailCollapsed: true,
    lyricsStageOpen: false,
  });
  await sleep(1300);
  await gif("visualizer", {
    durationMs: 5800,
    maxWidth: 700,
    fps: 12,
    everyNth: 3,
    colors: 96,
    drive: async () => {
      for (const style of ["bars", "radial", "led-reflex", "waveform"]) {
        await ctl("POST", "/settings", { visualizerStyle: style });
        await sleep(850);
      }
      // flip into lyrics mode (synced lyrics + translation over the cover palette)
      await ctl("POST", "/settings", { nowPlayingRightRailCollapsed: false, lyricsStageOpen: true });
      await sleep(2400);
    },
  });
  // restore baseline for the remaining captures
  await ctl("POST", "/settings", {
    nowPlayingRightRailCollapsed: true,
    lyricsStageOpen: false,
    flowEnabled: true,
    visualizerStyle: "bars",
  });
  await sleep(400);
}

// 3) Switch song — a real touchscreen swipe across the cover carousel (CDP touch).
if (want("switch-song")) {
  await ctl("POST", "/nav/tab", { tab: "now" });
  await ctl("POST", "/player/setDisplayMode", { mode: "cover" });
  await sleep(700);
  const box = await rectOf('[data-testid="now-cover-drag"]');
  if (!box) {
    process.stdout.write("  switch-song: cover drag element not found — skipped\n");
  } else {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = -box.w * 0.42; // swipe left → exactly one track forward, soft landing
    await gif("switch-song", {
      durationMs: 5200,
      maxWidth: 560,
      fps: 12,
      everyNth: 4,
      colors: 64,
      drive: async () => {
        await sleep(450);
        for (let i = 0; i < 3; i += 1) {
          await touchSwipe(cx, cy, dx, { steps: 14, holdMs: 16 });
          await sleep(1450);
        }
      },
    });
  }
}

// 4) Search — global ⌘F overlay with a live query + results.
if (want("search")) {
  await ctl("POST", "/search", { action: "reset" }).catch(() => {});
  await ctl("POST", "/search", { action: "open" });
  await sleep(700);
  for (const q of ["", "tanaka"]) {
    await ctl("POST", "/search", { action: "type", query: q });
    await sleep(250);
  }
  await ctl("POST", "/search", { action: "type", query: "love" });
  await sleep(900);
  await shot("search");
  await ctl("POST", "/search", { action: "close" });
}

// 5) Library — the 歌单 gallery (nav FAB item 2 → the "search" tab page).
if (want("library")) {
  await ctl("POST", "/nav/tab", { tab: "search" });
  await sleep(1100);
  await shot("library");
}

// 6) Settings — signature visual customization (the flow-background pane).
if (want("settings")) {
  await ctl("POST", "/nav/tab", { tab: "settings" });
  await sleep(600);
  await clickSel('[data-settings-item="flow"]').catch(() => {});
  await sleep(700);
  await shot("settings");
}

// 7) AI DJ — the Settings model pane where you connect an LLM so the agent can curate
//    sets and take requests like a DJ.
if (want("dj")) {
  await ctl("POST", "/nav/tab", { tab: "settings" });
  await sleep(500);
  await clickSel('[data-settings-item="ai-dj-model"]');
  await sleep(900);
  await shot("dj");
}

cdp.close();
process.stdout.write("done.\n");

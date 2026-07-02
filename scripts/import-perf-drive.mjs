#!/usr/bin/env node
// Dev E2E driver for the 2026-07-02 "playlist import async notify + batch O(n²)→O(n)"
// PRD (+ the ⌘F @filter transliteration commit). Attaches CDP to the RUNNING Electron
// renderer and exercises the REAL shipped code against REAL Electron IndexedDB — no
// mocks, no network, no login state — so we can prove on the desktop shell that:
//
//   A. addHitsToSet writes a large playlist in O(n) wall-clock (not O(n²)) — measured
//      against a THROWAWAY real IndexedDB (`muzero-perf-e2e`), so the user's library is
//      never touched. Also covers the "big set repeated re-sync" (all-dedupe) path.
//   B. The async-import notification lifecycle (runStreamedImportWithNotification) drives
//      the REAL top-left notification store: loading → live progress → terminal success.
//   C. The ⌘F @filter menu resolves Chinese aliases by pinyin (@gequ/@gd → 歌曲/歌单) and
//      Japanese kana aliases by romaji (@kyoku → 曲) with the REAL dictionaries loaded,
//      without a bare CJK needle leaking into an unrelated latin alias (曲 ↛ qq).
//
// Usage: node scripts/import-perf-drive.mjs [--port 39222] [--sizes 200,500,1000,2000]
//   Electron must be up with MUZERO_REMOTE_DEBUG_PORT set (scripts/electron-dev.mjs +
//   MUZERO_REMOTE_DEBUG_PORT=39222). Exit code is non-zero if any assertion fails.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const port = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT || 39222));
const sizes = String(arg("--sizes", "200,500,1000,2000"))
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => n > 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await pickPageTarget(port, "localhost");
process.stdout.write(`[import-perf] renderer: ${target.url}\n`);
const cdp = await connectCdp(target.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");
await cdp.send("Page.enable");

/** Evaluate an async expression in the renderer and return its by-value result. */
async function evalInPage(expression) {
  const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    const text = exceptionDetails.exception?.description || exceptionDetails.text;
    throw new Error(`page eval threw: ${text}`);
  }
  return result.value;
}

let failures = 0;
function check(label, cond, detail) {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

// ─────────────────────────────────────────────────────────────── A + C (one eval)
const AC = await evalInPage(`
  const repo = await import('/src/streamsrc/streamed-track-repo.ts');
  const { MuzeroDB } = await import('/src/db/muzero-db.ts');
  const reposMod = await import('/src/db/repositories.ts');
  const tl = await import('/src/lib/search-transliterate.ts');
  const gsf = await import('/src/lib/global-search-filter.ts');

  // ---- A. batch import perf against a THROWAWAY real IndexedDB ----
  const tdb = new MuzeroDB('muzero-perf-e2e');
  const mkHits = (n, off = 0) => Array.from({ length: n }, (_, i) => ({
    source: 'netease', externalId: 'e' + (i + off), title: '歌曲' + (i + off),
    artist: 'artist', album: 'album', durationSec: 180,
  }));
  const perf = [];
  let resync = null;
  try {
    for (const n of ${JSON.stringify(sizes)}) {
      const s = await reposMod.createSession({ seedPrompt: 'perf', name: 'perf-' + n }, tdb);
      const t0 = performance.now();
      const r = await repo.addHitsToSet(s.id, mkHits(n), tdb);
      const ms = performance.now() - t0;
      perf.push({ n, ms: +ms.toFixed(1), perItemUs: +((ms / n) * 1000).toFixed(2), added: r.added, skipped: r.skipped, tracks: r.tracks.length });
    }
    // Re-sync the largest set with the SAME hits → all dedupe, no new rows.
    const big = ${JSON.stringify(Math.max(...sizes))};
    const s2 = await reposMod.createSession({ seedPrompt: 'resync', name: 'resync' }, tdb);
    await repo.addHitsToSet(s2.id, mkHits(big), tdb);      // first import (warm)
    const t1 = performance.now();
    const r2 = await repo.addHitsToSet(s2.id, mkHits(big), tdb);  // re-import identical
    const ms2 = performance.now() - t1;
    resync = { n: big, ms: +ms2.toFixed(1), added: r2.added, skipped: r2.skipped };
  } finally {
    await tdb.delete();  // drop the throwaway DB entirely — zero footprint on the user library
  }

  // ---- C. ⌘F @filter transliteration with REAL dictionaries ----
  await tl.ensureTransliterationLoaded();
  const ready = tl.isTransliterationReady();
  const ids = (partial) => gsf.matchFilterOptions(partial).map((o) => o.id);
  const trans = {
    ready,
    gequ: ids('gequ'),     // 歌曲 via full pinyin → expect includes 'track'
    gd: ids('gd'),         // 歌单 via pinyin initials → expect includes 'set'
    kyoku: ids('kyoku'),   // 曲 (きょく) via romaji → expect includes 'track'
    artist: ids('artist'), // latin baseline → expect includes 'artist'
    wangyi: ids('wangyi'), // 网易 via pinyin → expect includes 'netease'
    quNeedle: ids('曲'),   // bare CJK needle must NOT leak into latin 'qq'
    songVariants: [...tl.searchVariants('歌曲')],
  };

  return { perf, resync, trans };
`);

console.log("\n── A. batch import wall-clock (real Electron IndexedDB, throwaway DB) ──");
for (const p of AC.perf) {
  console.log(
    `  n=${String(p.n).padStart(5)}  total=${String(p.ms).padStart(7)}ms  per-item=${String(p.perItemUs).padStart(6)}µs  added=${p.added} skipped=${p.skipped} tracks=${p.tracks}`,
  );
}
console.log(
  `  re-sync n=${AC.resync.n}: ${AC.resync.ms}ms  added=${AC.resync.added} skipped=${AC.resync.skipped}`,
);

// Perf assertions: correctness first, then the O(n) shape.
for (const p of AC.perf) {
  check(`A: n=${p.n} added=n, skipped=0 (all new)`, p.added === p.n && p.skipped === 0);
}
check(
  `A: re-sync of ${AC.resync.n} → added=0, skipped=${AC.resync.n} (dedupe holds)`,
  AC.resync.added === 0 && AC.resync.skipped === AC.resync.n,
);
// O(n): per-item time must stay roughly flat as n grows. Under O(n²) it would grow
// ~linearly with n (≈10× from smallest→largest here). Allow generous slack for GC/jitter.
const first = AC.perf[0];
const last = AC.perf[AC.perf.length - 1];
const growth = last.perItemUs / first.perItemUs;
check(
  `A: per-item time stays ~flat as n grows (O(n), not O(n²)) — growth ${growth.toFixed(2)}× over ${first.n}→${last.n}`,
  growth < 4,
  `per-item ${first.perItemUs}µs → ${last.perItemUs}µs`,
);
check(
  `A: largest import (${last.n}) finishes fast on desktop IDB`,
  last.ms < 4000,
  `${last.ms}ms`,
);

console.log("\n── C. ⌘F @filter transliteration (real dictionaries) ──");
console.log(`  dictionaries ready: ${AC.trans.ready}`);
console.log(`  searchVariants('歌曲'): ${JSON.stringify(AC.trans.songVariants)}`);
console.log(`  @gequ → ${JSON.stringify(AC.trans.gequ)}`);
console.log(`  @gd   → ${JSON.stringify(AC.trans.gd)}`);
console.log(`  @kyoku→ ${JSON.stringify(AC.trans.kyoku)}`);
console.log(`  @wangyi→ ${JSON.stringify(AC.trans.wangyi)}`);
console.log(`  @曲   → ${JSON.stringify(AC.trans.quNeedle)}`);
check("C: dictionaries loaded on desktop", AC.trans.ready === true);
check("C: @gequ (pinyin 歌曲) matches the track filter", AC.trans.gequ.includes("track"));
check("C: @gd (pinyin initials 歌单) matches the set filter", AC.trans.gd.includes("set"));
check("C: @kyoku (romaji きょく/曲) matches the track filter", AC.trans.kyoku.includes("track"));
check("C: @wangyi (pinyin 网易) matches the netease source filter", AC.trans.wangyi.includes("netease"));
check("C: @artist (latin) still matches artist", AC.trans.artist.includes("artist"));
check(
  "C: bare CJK needle 曲 does NOT leak into the latin 'qq' filter",
  !AC.trans.quNeedle.includes("qq"),
  JSON.stringify(AC.trans.quNeedle),
);

// ─────────────────────────────────────────────────────── B. notification lifecycle
console.log("\n── B. async-import notification lifecycle (real notification store) ──");
const B = await evalInPage(`
  const { runStreamedImportWithNotification } = await import('/src/stores/streamed-import-notification.ts');
  const { useNotificationStore } = await import('/src/stores/notification-store.ts');
  const snap = () => {
    const items = useNotificationStore.getState().queue || [];
    // Match our toast across its whole lifecycle: the loading + success messages both
    // carry the playlist name (《E2E 测试歌单》), and it is updated in place (stable id).
    const n = [...items].reverse().find((x) => (x.message || "").includes("E2E"));
    return n ? { type: n.type, message: n.message, detail: n.detail, progress: n.progress } : null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const phases = { loading: null, mid: null, success: null };
  const total = 1200;
  const p = runStreamedImportWithNotification({
    loadingLabel: '正在导入《E2E 测试歌单》…',
    errorLabel: '导入失败',
    run: async (onProgress) => {
      for (let done = 0; done <= total; done += 300) {
        onProgress(done, total);
        if (done === 0) await wait(30);       // let the loading toast settle
        if (done === 600) phases.mid = snap(); // capture live progress
        await wait(120);
      }
      return '已导入 ' + total + ' 首到《E2E 测试歌单》';
    },
  });
  await wait(20);
  phases.loading = snap();
  await p;
  phases.success = snap();
  return phases;
`);
console.log(`  loading: ${JSON.stringify(B.loading)}`);
console.log(`  mid:     ${JSON.stringify(B.mid)}`);
console.log(`  success: ${JSON.stringify(B.success)}`);
check("B: shows a persistent loading toast with the playlist name", B.loading && B.loading.message.includes("E2E"));
check(
  "B: live progress updates the same toast (detail counter + progress bar)",
  B.mid && B.mid.detail === "600 / 1200" && Math.abs((B.mid.progress ?? 0) - 0.5) < 0.001,
  JSON.stringify(B.mid),
);
check(
  "B: flips to a success toast with the imported count, progress bar cleared",
  B.success && B.success.type === "success" && B.success.message.includes("1200") && B.success.progress == null,
  JSON.stringify(B.success),
);

// ─────────────────────────────── visible proof: screenshot the top-left notification
console.log("\n── visual: capture the top-left import notification ──");
const notifId = await evalInPage(`
  const { notify } = await import('/src/stores/notification-store.ts');
  const id = notify.loading('正在导入《E2E 测试歌单》…');
  notify.update(id, { detail: '612 / 1200', progress: 0.51 });
  return id;
`);
await sleep(450);
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
const dir = path.join(process.cwd(), ".logs", "perf-reports");
mkdirSync(dir, { recursive: true });
const shotPath = path.join(dir, "import-notification.png");
writeFileSync(shotPath, Buffer.from(shot.data, "base64"));
console.log(`  screenshot: ${path.relative(process.cwd(), shotPath)}`);
await evalInPage(`
  const { notify } = await import('/src/stores/notification-store.ts');
  notify.dismiss(${JSON.stringify(notifId)});
  return null;
`);

cdp.close();
console.log(`\n[import-perf] ${failures === 0 ? "ALL PASSED ✅" : `${failures} FAILED ❌`}`);
process.exit(failures === 0 ? 0 : 1);

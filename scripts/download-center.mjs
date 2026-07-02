#!/usr/bin/env node
// Live E2E for the 下载 (Downloads) Gallery tab — the 6th library mode
// (PRD docs/prd/desktop/20260702-muzero-downloads-gallery-tab-prd).
//
// Drives the REAL renderer over CDP:
//   1. seeds a status-mix of download jobs straight into IndexedDB (muzero-db.downloadJobs),
//   2. navigates to Library → Downloads via the app's own shortcuts (Cmd/Ctrl+2 then bare 6),
//   3. snapshots the download-center DOM (filter chips + counts + row count + empty state),
//   4. flips the filter chips and re-snapshots,
//   5. asserts the all-status counts + virtualized rows + filtered-empty behavior,
//   6. cleans up the seeded rows (unless --keep).
//
// Prereqs: `pnpm electron:dev` (or the packaged dev build) running with
//   MUZERO_REMOTE_DEBUG_PORT set (default 9222). Usage:
//   node scripts/download-center.mjs [--port 9222] [--settle 500] [--keep]
import { connectCdp, pickPageTarget } from "./lib/cdp-client.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const port = Number(arg("--port", process.env.MUZERO_REMOTE_DEBUG_PORT ?? 9222));
const settleMs = Number(arg("--settle", 500));
const keep = process.argv.includes("--keep");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A status mix that exercises every bucket: inFlight(active+pending+paused)=3, done=1, failed=2.
const SEED = [
  { id: "dlc_a", status: "active", bytesDone: 50, totalBytes: 100, title: "E2E active" },
  { id: "dlc_p", status: "pending", title: "E2E pending" },
  { id: "dlc_pa", status: "paused", bytesDone: 30, totalBytes: 100, title: "E2E paused" },
  { id: "dlc_d", status: "done", title: "E2E done", trackId: "trk_e2e" },
  { id: "dlc_f1", status: "failed", lastError: "boom", title: "E2E failed 1" },
  { id: "dlc_f2", status: "failed", lastError: "boom", title: "E2E failed 2" },
].map((j, i) => ({
  source: "bili",
  externalId: `E2E${i}`,
  quality: "1080",
  bytesDone: 0,
  attempts: 0,
  createdAt: 1_700_000_000_000 + i,
  updatedAt: 1_700_000_000_000 + i,
  ...j,
}));
const SEED_IDS = SEED.map((j) => j.id);

async function evalPage(session, body) {
  const { result, exceptionDetails } = await session.send("Runtime.evaluate", {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.exception?.description ?? JSON.stringify(exceptionDetails));
  }
  return result.value;
}

// --- page-side helpers (stringified, run in the renderer) --------------------
const PAGE_PUT = (rows) => `
  const rows = ${JSON.stringify(rows)};
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('muzero-db');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('downloadJobs', 'readwrite');
    for (const row of rows) tx.objectStore('downloadJobs').put(row);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
  return rows.length;
`;
const PAGE_DELETE = (ids) => `
  const ids = ${JSON.stringify(ids)};
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('muzero-db');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  await new Promise((res, rej) => {
    const tx = db.transaction('downloadJobs', 'readwrite');
    for (const id of ids) tx.objectStore('downloadJobs').delete(id);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  db.close();
  return ids.length;
`;
const PAGE_PRESS = (code, mods) => `
  window.dispatchEvent(new KeyboardEvent('keydown', {
    code: ${JSON.stringify(code)}, key: ${JSON.stringify(code.replace("Digit", ""))},
    ctrlKey: ${!!mods.ctrl}, metaKey: ${!!mods.meta}, shiftKey: ${!!mods.shift}, bubbles: true,
  }));
  return true;
`;
const PAGE_CLICK = (testid) => `
  const el = document.querySelector('[data-testid=${JSON.stringify(testid)}]');
  if (el) el.click();
  return !!el;
`;
const PAGE_SNAPSHOT = `
  const root = document.querySelector('[data-testid="download-center"]');
  if (!root) return { present: false };
  const chip = (f) => {
    const el = document.querySelector('[data-testid="download-filter-' + f + '"]');
    return el ? { text: el.textContent.trim(), pressed: el.getAttribute('aria-pressed') } : null;
  };
  const rows = document.querySelectorAll('[data-testid="download-center-list"] [data-index]').length;
  const empty = document.querySelector('[data-testid="download-center-empty"]');
  return {
    present: true,
    chips: { all: chip('all'), active: chip('active'), done: chip('done'), failed: chip('failed') },
    rows,
    empty: empty ? empty.textContent.trim() : null,
  };
`;

const checks = [];
const expect = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
const num = (chip) => Number((chip?.text ?? "").replace(/\D+/g, ""));

async function main() {
  const target = await pickPageTarget(port);
  const session = await connectCdp(target.webSocketDebuggerUrl);
  await session.send("Runtime.enable", {});

  try {
    // 1) seed
    await evalPage(session, PAGE_PUT(SEED));
    // 2) navigate: Library (Cmd/Ctrl+2) then bare 6 (galleryTabDownloads)
    await evalPage(session, PAGE_PRESS("Digit2", { ctrl: true, meta: true }));
    await sleep(settleMs);
    await evalPage(session, PAGE_PRESS("Digit6", {}));
    await sleep(settleMs);

    const all = await evalPage(session, PAGE_SNAPSHOT);
    expect("download-center renders on the Downloads tab", all.present, all);
    expect("chip 全部 count = 6", num(all.chips?.all) === 6, all.chips?.all);
    expect("chip 进行中 count = 3 (active+pending+paused)", num(all.chips?.active) === 3, all.chips?.active);
    expect("chip 已完成 count = 1", num(all.chips?.done) === 1, all.chips?.done);
    expect("chip 失败 count = 2", num(all.chips?.failed) === 2, all.chips?.failed);
    expect("default 'all' filter renders rows (virtualized)", all.rows >= 1, all.rows);

    // 3) flip to 失败 → 2 rows, no empty state
    await evalPage(session, PAGE_CLICK("download-filter-failed"));
    await sleep(settleMs);
    const failed = await evalPage(session, PAGE_SNAPSHOT);
    expect("失败 chip is pressed", failed.chips?.failed?.pressed === "true", failed.chips?.failed);
    expect("失败 filter shows rows, not the empty state", failed.rows >= 1 && !failed.empty, failed);

    console.log(JSON.stringify({ all, failed, checks }, null, 2));
  } finally {
    if (!keep) await evalPage(session, PAGE_DELETE(SEED_IDS));
    session.close();
  }

  const failedChecks = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failedChecks.length}/${checks.length} checks passed`);
  if (failedChecks.length) {
    console.log("FAILED:");
    for (const c of failedChecks) console.log(`  ✗ ${c.name} — ${JSON.stringify(c.detail)}`);
    process.exit(1);
  }
  console.log("ALL PASSED ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

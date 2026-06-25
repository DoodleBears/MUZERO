#!/usr/bin/env node
// Live E2E for the ⌘F scope/media-kind filters (@online/@local/@Video/@Audio).
// Drives the REAL overlay over the live library via the dev control endpoint
// (PRD docs/prd/desktop/20260625-muzero-global-search-scope-media-filters-prd):
//   - applies each single-select filter through the SearchDriver (setFilter),
//   - snapshots the overlay's resolved scope + per-section result counts + song kinds,
//   - asserts the gating contract (local-scoped → online 0; @online → local worker
//     skipped; @video/@audio → only that Track.kind).
// Usage: node scripts/search-filter-drive.mjs [--settle 900]
import { readFileSync } from "node:fs";
import path from "node:path";

const conn = JSON.parse(
  readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"),
);
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
};
const settleMs = Number(arg("--settle", 900));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path_, body) {
  const res = await fetch(`${conn.url}${path_}`, {
    method: "POST",
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${path_} -> ${res.status} ${json.error}`);
  return json.data;
}
const search = (action, query) => call("/search", { action, query });

async function snapshotFor(filterId) {
  await search("filter", filterId ?? "clear");
  await sleep(settleMs);
  const data = await search("snapshot");
  return data?.data ?? data; // /search wraps as { search, data }
}

const checks = [];
const expect = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

async function main() {
  await search("open");
  await sleep(settleMs);

  const results = {};
  for (const id of ["video", "audio", "local", "online", "clear"]) {
    results[id] = await snapshotFor(id === "clear" ? null : id);
  }
  await search("close");

  const v = results.video;
  const a = results.audio;
  const l = results.local;
  const o = results.online;

  // @Video: local songs only, kind==="video", online cut.
  expect("@video scope.mediaKind==='video'", v?.scope?.mediaKind === "video", v?.scope);
  expect("@video online cut (showOnline=false, count 0)", v?.scope?.showOnline === false && v?.counts?.online === 0, v?.counts);
  expect("@video songs are ALL kind=video", (v?.songKinds ?? []).every((k) => k === "video"), v?.songKinds);

  // @Audio: local songs only, kind==="audio", online cut.
  expect("@audio scope.mediaKind==='audio'", a?.scope?.mediaKind === "audio", a?.scope);
  expect("@audio online cut (showOnline=false, count 0)", a?.scope?.showOnline === false && a?.counts?.online === 0, a?.counts);
  expect("@audio songs are ALL kind=audio", (a?.songKinds ?? []).every((k) => k === "audio"), a?.songKinds);

  // @local: all local sections allowed, online cut, worker runs.
  expect("@local online cut (showOnline=false, count 0)", l?.scope?.showOnline === false && l?.counts?.online === 0, l?.counts);
  expect("@local runs local worker + no mediaKind", l?.scope?.runsLocalWorker === true && l?.scope?.mediaKind === null, l?.scope);
  expect("@local shows every local section", l?.scope?.showSets && l?.scope?.showTracks && l?.scope?.showAlbums && l?.scope?.showArtists, l?.scope);

  // @online: local worker skipped, no local results, online section allowed.
  expect("@online skips local worker", o?.scope?.runsLocalWorker === false, o?.scope);
  expect("@online suppresses local sections (tracks/albums/artists 0)", o?.counts?.tracks === 0 && o?.counts?.albums === 0 && o?.counts?.artists === 0, o?.counts);

  console.log(JSON.stringify({ results, checks }, null, 2));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log("FAILED:");
    for (const c of failed) console.log(`  ✗ ${c.name} — ${JSON.stringify(c.detail)}`);
    process.exit(1);
  }
  console.log("ALL PASSED ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

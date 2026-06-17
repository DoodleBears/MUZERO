#!/usr/bin/env node
// Phase-2 render-trace sweep (PRD 20260617-reactivity-render-observability). For each
// high-frequency interaction it resets the render-trace, drives the interaction through
// the control endpoint, snapshots, and prints which SURFACES re-rendered — flagging any
// that did real work while HIDDEN (wasted reconcile). Pure control-endpoint (no CDP).
//   node scripts/render-sweep.mjs [scenario|all]
import { readFileSync } from "node:fs";
import path from "node:path";

const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const H = { "content-type": "application/json", "x-muzero-perf-token": conn.token };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ctl(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const j = await res.json();
  if (!j.ok) throw new Error(`${p} -> ${res.status} ${j.error}`);
  return j.data;
}
const reset = () => ctl("POST", "/renderTrace", { action: "reset" });
const snap = () => ctl("POST", "/renderTrace", {}).then((d) => d.entries ?? []);
const tab = (t) => ctl("POST", "/nav/tab", { tab: t });
const action = (id) => ctl("POST", "/action", { actionId: id }).catch(() => null);

// Each scenario: a sequence to drive AFTER reset (caller resets/snapshots).
const SCENARIOS = {
  // No interaction — just playback running. Isolates "who re-renders on positionSec ticks".
  playbackDwell: async () => {
    await ctl("POST", "/nav/tab", { tab: "now" });
    await ctl("POST", "/player/playIndex", { index: 2000 });
    await sleep(5000);
  },
  // Switch songs (the known path; F1/F2 baseline).
  switch: async () => {
    await ctl("POST", "/nav/tab", { tab: "now" });
    for (let i = 0; i < 5; i += 1) {
      await ctl("POST", "/player/next", {});
      await sleep(1200);
    }
  },
  like: async () => {
    await ctl("POST", "/nav/tab", { tab: "now" });
    for (let i = 0; i < 5; i += 1) {
      await action("playback.like");
      await sleep(700);
    }
  },
  metadata: async () => {
    await ctl("POST", "/nav/tab", { tab: "now" });
    for (let i = 0; i < 5; i += 1) {
      await ctl("POST", "/editMeta", {});
      await sleep(800);
    }
  },
  tabSwitch: async () => {
    for (const t of ["queue", "search", "sessions", "settings", "now"]) {
      await tab(t);
      await sleep(800);
    }
  },
  lyricsToggle: async () => {
    await ctl("POST", "/nav/tab", { tab: "now" });
    for (let i = 0; i < 4; i += 1) {
      await action("lyrics.toggleStage");
      await sleep(800);
    }
  },
};

function fmt(entries) {
  const rows = entries
    .filter((s) => s.actualMs > 0.05)
    .sort((a, b) => b.actualMs - a.actualMs);
  if (!rows.length) return "    (no surface did measurable render work)";
  return rows
    .map(
      (s) =>
        `    ${String(s.actualMs).padStart(7)}ms  ${String(s.commits).padStart(3)}× (${s.updateCommits} upd)  ${s.id}` +
        (s.hiddenActualMs > 0.5 ? `   ⚠ HIDDEN ${s.hiddenActualMs}ms/${s.hiddenCommits}×` : ""),
    )
    .join("\n");
}

const which = process.argv[2] || "all";
const names = which === "all" ? Object.keys(SCENARIOS) : [which];
for (const name of names) {
  if (!SCENARIOS[name]) {
    console.log(`unknown scenario: ${name}; have: ${Object.keys(SCENARIOS).join(", ")}`);
    continue;
  }
  // settle before reset so prior scenario's tail doesn't bleed in
  await sleep(800);
  await reset();
  await SCENARIOS[name]();
  await sleep(500);
  const entries = await snap();
  const hidden = entries.filter((s) => s.hiddenActualMs > 0.5).map((s) => s.id);
  console.log(`\n### ${name} ${hidden.length ? `— ⚠ hidden re-render: ${hidden.join(", ")}` : "— ✅ no hidden waste"}`);
  console.log(fmt(entries));
}

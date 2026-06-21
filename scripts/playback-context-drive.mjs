#!/usr/bin/env node
// E2E driver for the playback-queue-model refactor (Part A + Part B).
//
// Drives the dev control endpoint (electron/perf-control.cjs) against a RUNNING app
// to prove the actual effect of the fixes in the real renderer + IndexedDB:
//   1. A track shared across sets X and Y plays in the VIEWED set (Y), not its home (X).
//   2. Turning shuffle on materializes the queue (visible order = play order), pinning
//      the current track; turning it off restores the natural order.
//   3. next() advances linearly over the visible (shuffled) queue.
//
// Connection (port/token) is read from .logs/perf-control.json (written by the endpoint),
// or pass --url / --token. Exit code is non-zero if any assertion fails.

import fs from "node:fs";
import path from "node:path";

function readConn() {
  const fromArg = (name) => {
    const i = process.argv.indexOf(name);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  let url = fromArg("--url");
  let token = fromArg("--token");
  if (!url || !token) {
    const file = path.join(process.cwd(), ".logs", "perf-control.json");
    const conn = JSON.parse(fs.readFileSync(file, "utf8"));
    url ??= conn.url;
    token ??= conn.token;
  }
  return { url: url.replace(/\/$/, ""), token };
}

const { url, token } = readConn();

async function call(method, pathname, body) {
  const res = await fetch(`${url}${pathname}`, {
    method,
    headers: { "x-muzero-perf-token": token, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} ${pathname} → ${res.status} ${json.error ?? ""}`);
  return json.data;
}
const get = (p) => call("GET", p);
const post = (p, b) => call("POST", p, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = () => get("/state");

// Mutations like setShuffle fire their queue reorder async (fire-and-forget, as the UI
// consumes it reactively), so the action response is pre-settle. Poll /state until a
// predicate holds (or time out) to observe the settled state.
async function settle(pred, label) {
  for (let i = 0; i < 40; i++) {
    const s = await state();
    if (pred(s)) return s;
    await sleep(100);
  }
  return state();
}

let failures = 0;
function check(label, cond, detail) {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  console.log(`[e2e] driving ${url}`);
  await get("/health");

  // 1. Seed the cross-set scenario: A ∈ {X(home), Y}; Y = [A, B, C, D].
  const seed = await post("/playback/seed", {});
  console.log("[e2e] seeded", seed);

  const natural = [seed.trackA, seed.trackB, seed.trackC, seed.trackD];

  // 2. Part A — play the shared track A from set Y. Must play in Y, not X.
  await post("/playback/playInSet", { setId: seed.setY, trackId: seed.trackA });
  let s = await settle((x) => x.currentTrackId === seed.trackA && x.queueSource?.kind === "set");
  check(
    "Part A: queueSource is the VIEWED set Y (not home set X)",
    s.queueSource?.kind === "set" && s.queueSource.setId === seed.setY,
    `queueSource=${JSON.stringify(s.queueSource)} (X=${seed.setX})`,
  );
  check(
    "Part A: queue is Y's tracks in display order [A,B,C,D]",
    JSON.stringify(s.queueTrackIds) === JSON.stringify(natural),
    `queue=${JSON.stringify(s.queueTrackIds)}`,
  );
  check("Part A: current track is the clicked A", s.currentTrackId === seed.trackA);

  // 3. Part B — shuffle on materializes the queue, pinning current (A) first.
  await post("/player/setShuffle", { on: true });
  s = await settle((x) => x.shuffle === true && x.queueTrackIds.length === 4);
  check("Part B: shuffle flag on", s.shuffle === true);
  check(
    "Part B: current (A) pinned first after shuffle",
    s.queueTrackIds[0] === seed.trackA && s.currentTrackId === seed.trackA,
    `queue=${JSON.stringify(s.queueTrackIds)}`,
  );
  check(
    "Part B: shuffle kept all 4 tracks",
    new Set(s.queueTrackIds).size === 4 && natural.every((id) => s.queueTrackIds.includes(id)),
    `queue=${JSON.stringify(s.queueTrackIds)}`,
  );
  const shuffledOrder = s.queueTrackIds.slice();
  const expectedNext = shuffledOrder[1];

  // 4. Part B — next() advances linearly over the visible (shuffled) queue.
  await post("/player/next", {});
  s = await settle((x) => x.currentTrackId !== seed.trackA);
  check(
    "Part B: next() played the VISIBLE next track (linear over shuffled queue)",
    s.currentTrackId === expectedNext,
    `expected ${expectedNext}, got ${s.currentTrackId}; order=${JSON.stringify(shuffledOrder)}`,
  );

  // 5. Part B — shuffle off restores the natural order [A,B,C,D].
  await post("/player/setShuffle", { on: false });
  s = await settle((x) => JSON.stringify(x.queueTrackIds) === JSON.stringify(natural));
  check(
    "Part B: shuffle off restored natural order [A,B,C,D]",
    JSON.stringify(s.queueTrackIds) === JSON.stringify(natural),
    `queue=${JSON.stringify(s.queueTrackIds)}`,
  );

  // 6. Part B (Q8) — toggle shuffle on again → SAME order reused (stable per playlist).
  await post("/player/setShuffle", { on: true });
  s = await settle((x) => x.shuffle === true && x.queueTrackIds.length === 4);
  check(
    "Part B (Q8): toggling shuffle back on reuses the same order (not re-rolled)",
    JSON.stringify(s.queueTrackIds) === JSON.stringify(shuffledOrder),
    `now=${JSON.stringify(s.queueTrackIds)} prev=${JSON.stringify(shuffledOrder)}`,
  );

  console.log(`\n[e2e] ${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[e2e] driver error:", err.message);
  process.exit(2);
});

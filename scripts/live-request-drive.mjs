#!/usr/bin/env node
// Dev-only live-request routing driver for the control endpoint (PRD 20260616 live chat
// song request; reuses the 20260615 dev-control-endpoint harness). It drives the REAL
// running renderer's intake controller — route=search (library-search) over the live
// library — for each 【播放动作】 and asserts the matched track actually landed in the
// player/queue at the right slot:
//   - play-now    (立即播放)    → match becomes the CURRENT track + playing
//   - play-next   (下一首播放)  → match enters the upcoming queue right after current
//   - append-queue (追加队列)   → match becomes the queue TAIL
//
// Each probe runs against a FRESH queue: we re-activate the current set (the same thing
// clicking a 歌单 does — `playQueueSet`), which drops any leftover request/cut-in entries.
// That isolates the actions from each other, makes runs repeatable, AND cleans up after
// itself (no phantom queue entries left behind). play-now needs the "立即播放" config
// (requireApprovalForPlayNow=false); we flip it for the probe and restore the user's value.
//
// Usage:
//   node scripts/live-request-drive.mjs [--samples N] [--timeout MS]
//   node scripts/live-request-drive.mjs --video-id BV... [--playback-action play-next]
import { readFileSync } from "node:fs";
import path from "node:path";

const conn = JSON.parse(
  readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"),
);
const HEADERS = { "content-type": "application/json", "x-muzero-perf-token": conn.token };

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const sampleCount = Number(arg("--samples", 12));
const timeoutMs = Number(arg("--timeout", 5000));
const videoId = arg("--video-id", "");
const videoPlaybackAction = arg("--playback-action", "play-next");
const ROUTE = "library-search";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, p, body) {
  const res = await fetch(`${conn.url}${p}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${p} -> ${res.status} ${json.error}`);
  return json.data;
}

const state = () => call("GET", "/state");
const inject = (query, playbackAction) =>
  call("POST", "/live-request", { action: "inject", query, routeMode: ROUTE, playbackAction });
const injectVideo = (query, playbackAction) =>
  call("POST", "/live-request", { action: "inject", query, mediaKind: "video", playbackAction });

/** Seat the cursor at a fresh, distant index and PAUSE so the position is stable while we
 *  route a request (no auto-advance drift, no heavy set-reseed race). */
async function seatCursor(index) {
  await call("POST", "/player/playIndex", { index });
  await call("POST", "/player/pause");
  await waitFor((st) => !st.isPlaying, "paused");
  // settle: poll until the cursor stops moving for a few reads
  let prev = -999;
  let stable = 0;
  for (let i = 0; i < 24 && stable < 4; i++) {
    const st = await state();
    stable = st.currentIndex === prev ? stable + 1 : 0;
    prev = st.currentIndex;
    await sleep(120);
  }
  // Wait past the 900ms cursor-persist debounce so the DB cursor matches the playing
  // position — play-next/append insert relative to the persisted DB cursor (only play-now
  // was made store-cursor-relative). This mirrors steady playback, where the cursor has
  // long since persisted by the time a live request arrives.
  await sleep(1100);
  return state();
}

/** Poll /state until `pred(snapshot)` holds (or timeout) — queue writes land via liveQuery. */
async function waitFor(pred, label) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await state();
    if (pred(last)) return last;
    await sleep(120);
  }
  throw new Error(`timeout waiting for ${label}; last=${JSON.stringify(slim(last))}`);
}

const slim = (s) =>
  s && {
    currentIndex: s.currentIndex,
    queueLength: s.queueLength,
    currentTrackId: s.currentTrackId,
    nextTrackId: s.nextTrackId,
    lastTrackId: s.lastTrackId,
    isPlaying: s.isPlaying,
  };

const results = [];
const record = (action, ok, detail) => {
  results.push({ action, ok, detail });
  console.log(`${ok ? "✅ PASS" : "❌ FAIL"}  ${action.padEnd(13)} ${detail}`);
};

async function main() {
  const health = await fetch(`${conn.url}/health`).then((r) => r.json());
  if (!health.rendererReady) throw new Error("renderer not ready");
  const before = await state();
  console.log(`baseline: ${JSON.stringify(slim(before))}`);
  const sessionId = before.activeSessionId;
  if (!sessionId) throw new Error("no active session to test against");

  if (videoId) {
    const { item } = await injectVideo(videoId, videoPlaybackAction);
    const ok = item.status === "completed";
    record(
      "video-request",
      ok,
      `status=${item.status} match=${item.matchedTrackId ?? "-"} error=${item.error ?? "-"}`,
    );
    return finish(sessionId);
  }

  const { samples } = await call("POST", "/live-request", { action: "sample", count: sampleCount });
  if (!samples?.length) throw new Error("no sampleable tracks in the live queue");

  // Find a query whose library-search match is CONFIDENT (a clear winner). A non-confident
  // inject is a no-op; we probe with append-queue, then reset wipes the probe's append.
  let query = null;
  for (const s of samples) {
    const { item } = await inject(s.title, "append-queue");
    if (item.status === "completed" && item.matchedTrackId) {
      query = s.title;
      break;
    }
  }
  if (!query) {
    record(
      "search-match",
      false,
      `no confident library match among ${samples.length} sampled titles`,
    );
    return finish(sessionId);
  }
  console.log(`confident query: ${JSON.stringify(query)}\n`);

  // play-now (立即播放) — fresh cursor, approval off → match becomes current + playing.
  {
    await seatCursor(500);
    const { previousRequireApproval } = await call("POST", "/live-request", {
      action: "setApproval",
      value: false,
    });
    try {
      const { item } = await inject(query, "play-now");
      if (item.status !== "completed") {
        record("play-now", false, `status=${item.status} error=${item.error ?? "-"}`);
      } else {
        // PASS = the cut-in positioned the match as the current track (the bug we fixed).
        // isPlaying is informational: an unplayable track (e.g. QQ VIP/encrypted) lands as
        // current but won't start audio — that's track availability, not the cut-in.
        const after = await waitFor(
          (st) => st.currentTrackId === item.matchedTrackId,
          "play-now current == match",
        );
        const note = after.isPlaying ? "playing" : "current but not playing (track may be unplayable)";
        record("play-now", true, `match=${item.matchedTrackId} → current track (${note})`);
      }
    } finally {
      await call("POST", "/live-request", {
        action: "setApproval",
        value: Boolean(previousRequireApproval),
      });
    }
  }

  // play-next (下一首播放) — fresh cursor → match enters the upcoming block after current.
  {
    await seatCursor(900);
    const { item } = await inject(query, "play-next");
    if (item.status !== "completed") {
      record("play-next", false, `status=${item.status} error=${item.error ?? "-"}`);
    } else {
      const after = await waitFor(
        (st) => (st.upcomingTrackIds ?? []).includes(item.matchedTrackId),
        "play-next match in upcoming block",
      );
      const slot = after.upcomingTrackIds.indexOf(item.matchedTrackId) + 1;
      record("play-next", true, `match=${item.matchedTrackId} → upcoming slot +${slot}`);
    }
  }

  // append-queue (追加队列) — fresh cursor → match becomes the tail.
  {
    await seatCursor(1300);
    const { item } = await inject(query, "append-queue");
    if (item.status !== "completed") {
      record("append-queue", false, `status=${item.status} error=${item.error ?? "-"}`);
    } else {
      const after = await waitFor(
        (st) => st.lastTrackId === item.matchedTrackId,
        "append-queue tail == match",
      );
      record("append-queue", true, `match=${item.matchedTrackId} → queue tail (len ${after.queueLength})`);
    }
  }

  finish(sessionId);
}

async function finish(sessionId) {
  // Leave the queue clean (reseeded from the set, no phantom request/cut-in entries).
  if (sessionId) {
    try {
      await call("POST", "/player/setActiveSession", { sessionId });
    } catch {
      /* best effort */
    }
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} actions passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((error) => {
  console.error(`\n💥 ${error.message}`);
  process.exit(1);
});

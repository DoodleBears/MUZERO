#!/usr/bin/env node
// Dev driver: backfill an existing streamed track's official cover (no video re-download).
//   node scripts/stream-cover.mjs <trackId>
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const trackId = process.argv[2];
if (!trackId) {
  console.error("usage: stream-cover.mjs <trackId>");
  process.exit(1);
}

const res = await fetch(`${conn.url}/stream/cover`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify({ trackId }),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

#!/usr/bin/env node
// Dev driver: detect a pasted link / bare id and resolve it targeted (getTracksByIds),
// mirroring the ⌘F overlay. Usage:
//   node scripts/stream-resolve-link.mjs "<url-or-bvid-or-ytid>"
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const text = process.argv[2];
if (!text) {
  console.error("usage: stream-resolve-link.mjs <url|BVid|ytid>");
  process.exit(1);
}

const res = await fetch(`${conn.url}/stream/resolve-link`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify({ text }),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

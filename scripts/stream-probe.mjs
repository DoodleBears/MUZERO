#!/usr/bin/env node
// Dev E2E driver: probe a stream source's video resolve/quality-list against the LIVE API
// via the perf-control endpoint (the running Electron renderer does the actual request, so
// muzfetch header injection / CORS bypass apply). Usage:
//   node scripts/stream-probe.mjs <bvid[#cid]> [quality] [sourceId]
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
// usage:
//   node scripts/stream-probe.mjs <bvid[#cid]> [quality] [sourceId]
//   node scripts/stream-probe.mjs --search "<query>" [quality] [sourceId]
const args = process.argv.slice(2);
let body;
if (args[0] === "--search") {
  body = { sourceId: args[3] || "bili", search: args[1], quality: args[2] };
} else if (args[0]) {
  body = { sourceId: args[2] || "bili", externalId: args[0], quality: args[1] };
} else {
  console.error("usage: stream-probe.mjs <bvid[#cid]> [quality] | --search <query> [quality]");
  process.exit(1);
}

const res = await fetch(`${conn.url}/stream/probe`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

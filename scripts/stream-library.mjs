#!/usr/bin/env node
// Dev E2E driver: download a streamed video INTO the library (task #9) via the running
// renderer — resolve → fetch/blob → mux → persist as a local-backed streamed video track
// in a "Downloads" set. Usage:
//   node scripts/stream-library.mjs <id[#cid]> [quality] [sourceId] [title]
//   node scripts/stream-library.mjs --search "<query>" [quality] [sourceId]
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const args = process.argv.slice(2);
let body;
if (args[0] === "--search") {
  body = { sourceId: args[3] || "bili", search: args[1], quality: args[2] };
} else if (args[0]) {
  body = { sourceId: args[2] || "bili", externalId: args[0], quality: args[1], title: args[3] };
} else {
  console.error("usage: stream-library.mjs <id[#cid]> [quality] [sourceId] [title] | --search <q>");
  process.exit(1);
}

const res = await fetch(`${conn.url}/stream/library`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

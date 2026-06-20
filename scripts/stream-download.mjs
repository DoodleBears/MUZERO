#!/usr/bin/env node
// Dev E2E driver: full video download (resolve video+audio → fetch via media proxy →
// copy-remux with mediabunny) through the running Electron renderer. Reports byte sizes
// so we can confirm the mux produced a real container. Usage:
//   node scripts/stream-download.mjs <bvid[#cid]> [quality]
//   node scripts/stream-download.mjs --search "<query>" [quality]   (picks the shortest hit)
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const args = process.argv.slice(2);
let body;
if (args[0] === "--search") {
  body = { sourceId: "bili", search: args[1], quality: args[2] };
} else if (args[0]) {
  body = { sourceId: "bili", externalId: args[0], quality: args[1] };
} else {
  console.error("usage: stream-download.mjs <bvid[#cid]> [quality] | --search <query> [quality]");
  process.exit(1);
}

const res = await fetch(`${conn.url}/stream/download`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

#!/usr/bin/env node
// Dev driver: list a source's user playlists (Bilibili 收藏夹 sync), optionally import one.
//   node scripts/stream-playlists.mjs [sourceId] [importMediaId]
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const body = { sourceId: process.argv[2] || "bili", importId: process.argv[3] };

const res = await fetch(`${conn.url}/stream/playlists`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

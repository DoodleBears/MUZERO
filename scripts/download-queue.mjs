#!/usr/bin/env node
// Dev driver for the persistent download queue (E2E). Usage:
//   node scripts/download-queue.mjs list
//   node scripts/download-queue.mjs enqueue <externalId> [quality] [source]
//   node scripts/download-queue.mjs seedActive <externalId> [source]
//   node scripts/download-queue.mjs recover
//   node scripts/download-queue.mjs clearAll
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const [action, externalId, quality, source] = process.argv.slice(2);
const body = { action: action || "list", externalId, quality, source: source || "bili" };

const res = await fetch(`${conn.url}/download/queue`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

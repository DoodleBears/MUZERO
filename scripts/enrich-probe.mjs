#!/usr/bin/env node
// Dev E2E driver: probe whether a stream source's song-detail carries genre/style/tag metadata,
// against the LIVE API via the perf-control endpoint (the running Electron renderer issues the
// authenticated request with the user's cookie + muzfetch). Usage:
//   node scripts/enrich-probe.mjs <netease|qq> --search "<artist> <title>"
//   node scripts/enrich-probe.mjs <netease|qq> --id <externalId>
import { readFileSync } from "node:fs";

const conn = JSON.parse(readFileSync(".logs/perf-control.json", "utf8"));
const args = process.argv.slice(2);
const sourceId = args[0] || "netease";
const body = { sourceId };
const idIdx = args.indexOf("--id");
const searchIdx = args.indexOf("--search");
if (idIdx >= 0) body.externalId = args.slice(idIdx + 1).join(" ");
else if (searchIdx >= 0) body.search = args.slice(searchIdx + 1).join(" ");
else body.search = args.slice(1).join(" "); // bare query after the source id
if (!body.externalId && !body.search) {
  console.error('usage: enrich-probe.mjs <netease|qq> --search "<artist> <title>" | --id <externalId>');
  process.exit(1);
}

const res = await fetch(`${conn.url}/enrich/probe`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-muzero-perf-token": conn.token },
  body: JSON.stringify(body),
});
const json = await res.json();
console.log(JSON.stringify(json, null, 2));
process.exit(json.ok ? 0 : 2);

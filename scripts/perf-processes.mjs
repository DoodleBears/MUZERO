// Electron process memory snapshot via the dev-only perf-control endpoint.
//   1) pnpm electron:profile
//   2) node scripts/perf-processes.mjs
import { readFileSync } from "node:fs";
import path from "node:path";

const conn = JSON.parse(readFileSync(path.join(process.cwd(), ".logs", "perf-control.json"), "utf8"));
const res = await fetch(`${conn.url}/processes`, {
  headers: { "x-muzero-perf-token": conn.token },
});
const payload = await res.json();
if (!res.ok || !payload.ok) {
  throw new Error(payload.error || `process metrics failed: ${res.status}`);
}

const snapshot = payload.data;
const rows = [...snapshot.processes].sort(
  (a, b) => b.memory.workingSetMb - a.memory.workingSetMb,
);

console.log(`capturedAt ${new Date(snapshot.capturedAt).toISOString()}`);
console.log(
  `total workingSet ${snapshot.totals.workingSetMb.toFixed(1)} MB, private ${snapshot.totals.privateMb.toFixed(1)} MB`,
);
console.log("");
console.log("type                 pid       workingSet MB   private MB   cpu %   name");
console.log("--------------------------------------------------------------------------");
for (const row of rows) {
  console.log(
    [
      String(row.type || "unknown").padEnd(20),
      String(row.pid ?? "").padStart(7),
      row.memory.workingSetMb.toFixed(1).padStart(15),
      row.memory.privateMb.toFixed(1).padStart(12),
      row.cpuPercent.toFixed(1).padStart(7),
      row.name || row.serviceName || "",
    ].join(" "),
  );
}

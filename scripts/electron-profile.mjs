#!/usr/bin/env node
// Prod-build CPU-profiling launcher (PRD 20260616-agent-cpu-profiling-harness).
//
// The first profiles were a DEV build and were ~750ms polluted by jsxDEV + Vite +
// our own trace-observer (formatTraceEntry/sanitizeValue). To get TRUE numbers we must
// profile a production renderer — but the control-endpoint bridge is tree-shaken out of
// prod. So this builds a PRODUCTION bundle that KEEPS the bridge via VITE_MUZERO_PROFILE,
// then launches Electron (loading the built dist via app://) with the renderer debug port
// + the control endpoint, so `scripts/perf-profile.mjs` can drive a real switch over a
// clean prod build. Dev-only: the flag is never set for release builds, and the bridge
// stays inert without the main-process control server (gated on !app.isPackaged).
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const port = process.env.MUZERO_REMOTE_DEBUG_PORT || "39222";
const require = createRequire(import.meta.url);
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const electronPath = require("electron"); // package's default export is the binary path

// The agent shell exports ELECTRON_RUN_AS_NODE=1, which makes Electron boot as plain Node
// (no app/GUI). Strip it from the children so Electron launches normally.
const baseEnv = { ...process.env };
baseEnv.ELECTRON_RUN_AS_NODE = undefined;

process.stdout.write("[profile] building production renderer (with control bridge)…\n");
const build = spawnSync(process.execPath, [viteBin, "build"], {
  env: { ...baseEnv, VITE_MUZERO_PROFILE: "1" },
  shell: false,
  stdio: "inherit",
});
if (build.status !== 0) process.exit(build.status ?? 1);

process.stdout.write(
  `[profile] launching prod preview + remote-debug :${port} + control endpoint…\n` +
    `[profile] once "DevTools listening" + the control banner appear, capture in another terminal:\n` +
    `    make perf-profile                          (pingpong, warm covers)\n` +
    `    make perf-profile PROFILE_SCENARIO=switch  (cold next-track switches)\n`,
);
// No MUZERO_ELECTRON_URL → electron/main.cjs loads the built dist via app://muzero.
const electron = spawn(electronPath, ["electron/main.cjs"], {
  env: { ...baseEnv, MUZERO_PERF_CONTROL: "1", MUZERO_REMOTE_DEBUG_PORT: port },
  shell: false,
  stdio: "inherit",
});
electron.once("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => electron.kill());
process.on("SIGTERM", () => electron.kill());

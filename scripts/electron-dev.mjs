#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = argValue("--port") || process.env.MUZERO_DEV_PORT || "41730";
const devUrl = argValue("--url") || process.env.MUZERO_ELECTRON_URL || `http://localhost:${port}`;
const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
const electronmonBin = fileURLToPath(
  new URL("../node_modules/electronmon/bin/cli.js", import.meta.url),
);

let viteProcess = null;
let electronProcess = null;
let shuttingDown = false;

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function spawnInherit(args, env = {}) {
  return spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    shell: false,
    stdio: "inherit",
    windowsHide: false,
  });
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}`);
}

function stopChild(child) {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }
  child.kill("SIGTERM");
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChild(electronProcess);
  stopChild(viteProcess);
  setTimeout(() => process.exit(code), 50);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

if (await isReachable(devUrl)) {
  process.stdout.write(`Reusing Vite dev server at ${devUrl}\n`);
} else {
  process.stdout.write(`Starting Vite dev server at ${devUrl}\n`);
  viteProcess = spawnInherit([viteBin], { MUZERO_DEV_PORT: port });
  viteProcess.once("exit", (code) => {
    if (!shuttingDown) shutdown(code ?? 1);
  });
  await waitForUrl(devUrl);
}

electronProcess = spawnInherit([electronmonBin, "electron/main.cjs"], {
  MUZERO_DEV_PORT: port,
  MUZERO_ELECTRON_URL: devUrl,
});

electronProcess.once("exit", (code) => shutdown(code ?? 0));

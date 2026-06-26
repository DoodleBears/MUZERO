import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Vitest config kept separate from vite.config.ts so the Tailwind plugin and
// Tauri build target don't run during unit tests.

// Mirror vite.config.ts's version define so src/lib/app-version.ts resolves the
// same __APP_VERSION__ etc. under test as in a real build.
const pkgVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8"),
).version as string;
function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkgVersion),
    __GIT_SHA__: JSON.stringify(gitSha()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
    css: false,
    // The full suite (450+ files, each jsdom + fake-indexeddb) saturated all
    // cores under the default forks pool, starving the async IndexedDB-backed
    // store tests past their timeouts (flaky CI/pre-push failures). Cap workers
    // to leave CPU headroom so heavy tests still get scheduled, and give a small
    // global timeout cushion. The percentage is portable: ~1 worker on low-core
    // CI runners, ~9 on a 16-core dev box.
    pool: "forks",
    maxWorkers: "60%",
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});

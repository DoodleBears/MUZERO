import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Serve / bundle the @sglkc/kuromoji IPADIC dictionary (~17MB of .dat.gz) at a stable URL so
// the search worker can fetch readings for Japanese kanji titles. Dev: a middleware streams
// the files from node_modules; build: they're emitted as assets at the same path. Kept out of
// `public/` so the 17MB never enters git. The worker fetches `${KUROMOJI_DICT_PATH}/<file>`
// (see src/lib/kuromoji-tokenizer.ts) — keep this prefix in sync with that constant.
function kuromojiDictPlugin(): Plugin {
  const dictDir = fileURLToPath(new URL("./node_modules/@sglkc/kuromoji/dict", import.meta.url));
  const PREFIX = "/kuromoji-dict/";
  const isDictFile = (name: string): boolean => /^[a-z_]+\.dat\.gz$/.test(name);
  return {
    name: "muzero-kuromoji-dict",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (!url.startsWith(PREFIX)) return next();
        const file = url.slice(PREFIX.length).split("?")[0];
        if (!isDictFile(file)) return next();
        try {
          const buf = readFileSync(join(dictDir, file));
          res.setHeader("Content-Type", "application/gzip");
          res.end(buf);
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const file of readdirSync(dictDir)) {
        if (!isDictFile(file)) continue;
        this.emitFile({
          type: "asset",
          fileName: `kuromoji-dict/${file}`,
          source: readFileSync(join(dictDir, file)),
        });
      }
    },
  };
}

// @tauri-apps/cli injects TAURI_ENV_* during `tauri dev` / `tauri build`.
const host = process.env.TAURI_DEV_HOST;

// Build-time version/release identity. package.json `version` is the single
// source of truth (kept in sync with tauri.conf.json + Cargo.toml by
// scripts/bump-version.mjs). Injected as __APP_VERSION__ etc. and read only
// through src/lib/app-version.ts. Keep this identical to vitest.config.ts.
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
const versionDefine = {
  __APP_VERSION__: JSON.stringify(pkgVersion),
  __GIT_SHA__: JSON.stringify(gitSha()),
  __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
};

// Dev-server port — configurable so the browser loop (`make dev`, 41730) and the
// Tauri desktop shell (`make desktop`, 41732) can run at the same time on separate
// ports. `make desktop` sets MUZERO_DEV_PORT and passes a matching `--config`
// devUrl to Tauri (see Makefile). Defaults to a project-specific high port.
const devPort = Number(process.env.MUZERO_DEV_PORT) || 41730;
const hmrPort = Number(process.env.MUZERO_HMR_PORT) || 41731;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), kuromojiDictPlugin()],

  define: versionDefine,

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // youtubei.js is exports-map-only (no main/module) and pulled in deep by the
  // YouTube source; pre-bundle it so the dev server resolves it (its browser
  // condition → web.js, which ships the JS evaluator we need for deciphering).
  optimizeDeps: {
    // youtubei.js: exports-map-only, pulled deep by the YouTube source.
    // @sglkc/kuromoji: CommonJS — pre-bundle so the search worker resolves it (the browser
    // field swaps in the fetch-based dict loader for the worker build).
    include: ["youtubei.js", "@sglkc/kuromoji"],
  },

  // Tauri expects a fixed port and fails if it's not available.
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: hmrPort }
      : undefined,
    watch: {
      // Don't watch the Rust side from the Vite dev server.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce a build the Tauri webview (and mobile WebViews) can load.
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },

  // Vite inlines VITE_-prefixed env vars; nothing secret here (BYOK keys live in
  // IndexedDB via Settings, never in the bundle — see CLAUDE.md §Secrets).
  envPrefix: ["VITE_", "TAURI_ENV_"],
});

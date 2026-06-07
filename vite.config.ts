import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @tauri-apps/cli injects TAURI_ENV_* during `tauri dev` / `tauri build`.
const host = process.env.TAURI_DEV_HOST;

// Dev-server port — configurable so the browser loop (`make dev`, 1420) and the
// Tauri desktop shell (`make desktop`, 1430) can run at the same time on separate
// ports. `make desktop` sets MUZERO_DEV_PORT and passes a matching `--config`
// devUrl to Tauri (see Makefile). Defaults to 1420 so plain `pnpm dev` is unchanged.
const devPort = Number(process.env.MUZERO_DEV_PORT) || 1420;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Tauri expects a fixed port and fails if it's not available.
  clearScreen: false,
  server: {
    port: devPort,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
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

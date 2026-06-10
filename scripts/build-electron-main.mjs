#!/usr/bin/env node
/**
 * Bundle the Electron main process + preload into dist-electron/ with esbuild,
 * inlining every npm dependency (e.g. electron-updater) so the packaged app can
 * exclude node_modules entirely — the single biggest installer-size lever. Only
 * `electron` and node builtins stay external (provided by the runtime).
 *
 * Dev still runs the raw electron/*.cjs (see `make electron-dev`); this bundle is
 * for packaging. main.cjs resolves `../dist` and `./preload.cjs` relative to its
 * own dir, and dist-electron/ sits beside dist/ in the packaged app, so those
 * paths stay correct. See docs/prd/20260611-muzero-release-pipeline-changelog-prd §3 (Phase 3).
 */
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const ESBUILD_OPTIONS = {
  entryPoints: {
    main: join(ROOT, "electron/main.cjs"),
    preload: join(ROOT, "electron/preload.cjs"),
  },
  outdir: join(ROOT, "dist-electron"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  // electron is provided by the runtime; node builtins are external on platform:node.
  external: ["electron"],
  outExtension: { ".js": ".cjs" },
  logLevel: "info",
};

if (process.argv[1]?.endsWith("build-electron-main.mjs")) {
  await build(ESBUILD_OPTIONS);
  process.stdout.write("Bundled electron main + preload → dist-electron/\n");
}

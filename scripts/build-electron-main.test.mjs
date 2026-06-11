// @vitest-environment node
// esbuild requires a real Node environment (jsdom's TextEncoder breaks its invariant).
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { ESBUILD_OPTIONS } from "./build-electron-main.mjs";

const ROOT = process.cwd();

// Provided by the runtime: electron + node builtins (bare or node:-prefixed).
const RUNTIME = new Set([
  "electron",
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
]);

// Anything left as a bare require that ISN'T runtime-provided is a leaked npm dep
// — it would crash the packaged app (node_modules is excluded). Integrity guard.
function externalBareRequires(code) {
  const requires = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  return requires.filter((id) => !id.startsWith(".") && !RUNTIME.has(id));
}

describe("electron main bundle", () => {
  it("bundles main + preload to cjs with only electron/node externals", async () => {
    const result = await build({ ...ESBUILD_OPTIONS, write: false });
    const files = Object.fromEntries(result.outputFiles.map((f) => [f.path, f.text]));

    const main = Object.entries(files).find(([p]) => p.endsWith("main.cjs"));
    const preload = Object.entries(files).find(([p]) => p.endsWith("preload.cjs"));
    expect(main, "expected dist-electron/main.cjs").toBeTruthy();
    expect(preload, "expected dist-electron/preload.cjs").toBeTruthy();

    for (const [path, code] of [main, preload]) {
      const leaked = externalBareRequires(code);
      expect(leaked, `${path} left these npm deps unbundled: ${leaked.join(", ")}`).toEqual([]);
    }
  });
});

// Guard against accidentally pointing electron-builder at a non-existent entry.
describe("packaging entry", () => {
  it("package.json main points at the bundled output", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.main).toBe("dist-electron/main.cjs");
  });
});

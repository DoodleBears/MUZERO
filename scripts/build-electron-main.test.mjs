// @vitest-environment node
// esbuild requires a real Node environment (jsdom's TextEncoder breaks its invariant).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import { ESBUILD_OPTIONS } from "./build-electron-main.mjs";

const ROOT = process.cwd();

// Allowed external requires in the bundled main: electron + node builtins only.
// Anything else means an npm dep leaked unbundled — it would crash the packaged
// app (node_modules is excluded). This is the build-integrity guard.
function externalBareRequires(code) {
  const requires = [...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  return requires.filter(
    (id) => id !== "electron" && !id.startsWith("node:") && !id.startsWith("."),
  );
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

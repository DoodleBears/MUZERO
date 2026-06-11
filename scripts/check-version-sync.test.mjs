import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectVersions, versionsInSync } from "./check-version-sync.mjs";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/check-version-sync.mjs");

describe("collectVersions", () => {
  it("reads a version from all three lockstep files (they're in sync in the repo)", () => {
    const versions = collectVersions(ROOT);
    expect(Object.keys(versions).sort()).toEqual(["Cargo.toml", "package.json", "tauri.conf.json"]);
    for (const v of Object.values(versions)) {
      expect(v).toMatch(/^\d+\.\d+\.\d+/);
    }
    expect(versionsInSync(versions)).toBe(true);
  });
});

describe("versionsInSync", () => {
  it("is true only when all three match", () => {
    expect(versionsInSync({ a: "0.1.0", b: "0.1.0", c: "0.1.0" })).toBe(true);
    expect(versionsInSync({ a: "0.1.0", b: "0.2.0", c: "0.1.0" })).toBe(false);
  });
  it("is false when any version is missing", () => {
    expect(versionsInSync({ a: "0.1.0", b: "0.1.0", c: null })).toBe(false);
  });
});

describe("check-version-sync.mjs", () => {
  it("exits 0 when the repo is in sync", () => {
    const out = execFileSync("node", [SCRIPT], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain("version in sync");
  });
});

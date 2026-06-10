import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nextVersion } from "./bump-version.mjs";

// Vitest runs with cwd = project root; avoid import.meta.url (not a file:// URL
// under the test transform).
const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/bump-version.mjs");

describe("nextVersion", () => {
  it("bumps major/minor/patch", () => {
    expect(nextVersion("0.7.0", "major")).toBe("1.0.0");
    expect(nextVersion("0.7.3", "minor")).toBe("0.8.0");
    expect(nextVersion("0.7.0", "patch")).toBe("0.7.1");
  });

  it("starts a next-minor prerelease for beta from a release", () => {
    expect(nextVersion("0.7.0", "beta")).toBe("0.8.0-beta.1");
  });

  it("increments an existing beta", () => {
    expect(nextVersion("0.8.0-beta.1", "beta")).toBe("0.8.0-beta.2");
  });

  it("throws on an unrecognized current version", () => {
    expect(() => nextVersion("garbage", "patch")).toThrow();
  });
});

describe("bump-version.mjs --dry-run", () => {
  it("reports current→next and the three lockstep files without writing", () => {
    const out = execFileSync("node", [SCRIPT, "minor", "--dry-run"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const summary = JSON.parse(out);
    expect(summary.type).toBe("minor");
    expect(summary.next).toBe(nextVersion(summary.current, "minor"));
    expect(summary.files).toEqual([
      "package.json",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.toml",
    ]);
  });

  it("exits non-zero on a bad bump type", () => {
    expect(() => execFileSync("node", [SCRIPT, "nope"], { cwd: ROOT, stdio: "ignore" })).toThrow();
  });
});

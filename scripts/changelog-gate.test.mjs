import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { changelogSkeleton } from "./scaffold-changelog.mjs";

const ROOT = process.cwd();
const CHECK = join(ROOT, "scripts/check-changelog.mjs");
const RELEASES_DIR = join(ROOT, "src/content/changelog/releases");

function existingVersion() {
  const file = readdirSync(RELEASES_DIR).find((f) => /^\d+\.\d+\.\d+\.ts$/.test(f));
  return file ? file.replace(/\.ts$/, "") : null;
}

describe("changelogSkeleton", () => {
  it("stubs the version and all 4 locales as a valid TS module", () => {
    const out = changelogSkeleton("1.2.3");
    expect(out).toContain('version: "1.2.3"');
    expect(out).toContain('import type { ChangelogRelease }');
    for (const loc of ["en", "zh", "ja", "ko"]) {
      expect(out).toContain(`${loc}:`);
    }
    expect(out).toContain("export default release;");
  });
});

describe("check-changelog.mjs (release gate)", () => {
  it("exits 0 when the changelog file for a version exists", () => {
    const version = existingVersion();
    expect(version, "expected at least one backfilled release file").not.toBeNull();
    const out = execFileSync("node", [CHECK, "--version", version], { cwd: ROOT, encoding: "utf8" });
    expect(out).toContain(`changelog present for ${version}`);
  });

  it("exits non-zero when the changelog file is missing", () => {
    expect(() =>
      execFileSync("node", [CHECK, "--version", "0.0.999"], { cwd: ROOT, stdio: "ignore" }),
    ).toThrow();
  });
});

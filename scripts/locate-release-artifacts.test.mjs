import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { releaseArtifacts } from "./locate-release-artifacts.mjs";

describe("releaseArtifacts", () => {
  it("finds top-level electron-builder artifacts and ignores directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "muzero-release-"));
    mkdirSync(join(dir, "win-unpacked"));
    writeFileSync(join(dir, "MUZERO Setup 1.0.0.exe"), "installer");
    writeFileSync(join(dir, "latest.yml"), "feed");
    writeFileSync(join(dir, "builder-effective-config.yaml"), "debug config");
    writeFileSync(join(dir, "MUZERO Setup 1.0.0.exe.blockmap"), "blockmap");

    expect(releaseArtifacts(dir).map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      "latest.yml",
      "MUZERO Setup 1.0.0.exe",
    ]);
  });

  it("returns an empty list when the release dir does not exist", () => {
    expect(releaseArtifacts(join(tmpdir(), "muzero-release-missing"))).toEqual([]);
  });
});

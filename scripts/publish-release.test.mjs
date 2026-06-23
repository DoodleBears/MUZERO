import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cmpVersion,
  emptyManifest,
  mergeRelease,
  platformKeyFor,
  prefixFeedReferences,
} from "./publish-release.mjs";

const ROOT = process.cwd();
const SCRIPT = join(ROOT, "scripts/publish-release.mjs");

const asset = (file) => ({
  file,
  url: `https://assets.mu0.app/desktop/${file}`,
  size: 10,
  sha256: "deadbeef",
});

describe("cmpVersion (newest-first)", () => {
  it("orders releases and ranks prerelease below release", () => {
    const sorted = ["0.7.0", "0.8.0", "0.8.0-beta.1", "0.10.0"].sort(cmpVersion);
    expect(sorted).toEqual(["0.10.0", "0.8.0", "0.8.0-beta.1", "0.7.0"]);
  });
});

describe("platformKeyFor", () => {
  it("maps installers to platform keys and ignores feed/updater files", () => {
    expect(platformKeyFor("MUZERO-0.7.0-arm64.dmg")).toBe("mac-arm64");
    expect(platformKeyFor("MUZERO-0.7.0-x64.dmg")).toBe("mac-x64");
    expect(platformKeyFor("MUZERO-0.7.0.dmg")).toBe("mac-x64"); // electron-builder leaves x64 arch-less
    expect(platformKeyFor("MUZERO Setup 0.7.0.exe")).toBe("win-x64");
    expect(platformKeyFor("MUZERO-0.7.0.AppImage")).toBe("linux-x64-appimage");
    expect(platformKeyFor("muzero_0.7.0_amd64.deb")).toBe("linux-x64-deb");
    expect(platformKeyFor("MUZERO-0.7.0-arm64-mac.zip")).toBeNull();
    expect(platformKeyFor("latest-mac.yml")).toBeNull();
    expect(platformKeyFor("MUZERO-0.7.0-arm64.dmg.blockmap")).toBeNull();
  });
});

describe("mergeRelease (additive, per-platform)", () => {
  const t = "2026-06-11T00:00:00.000Z";

  it("creates a release and sets latest", () => {
    const m = mergeRelease(
      emptyManifest(),
      { version: "0.7.0", date: "2026-06-11", channel: "stable", notesRef: "0.7.0", platform: "mac-arm64", asset: asset("0.7.0/a.dmg") },
      t,
    );
    expect(m.latest).toBe("0.7.0");
    expect(Object.keys(m.releases[0].platforms)).toEqual(["mac-arm64"]);
  });

  it("a second OS publishing the SAME version does not clobber the first", () => {
    let m = mergeRelease(
      emptyManifest(),
      { version: "0.7.0", date: "2026-06-11", channel: "stable", notesRef: "0.7.0", platform: "mac-arm64", asset: asset("0.7.0/a.dmg") },
      t,
    );
    m = mergeRelease(
      m,
      { version: "0.7.0", date: "2026-06-11", channel: "stable", notesRef: "0.7.0", platform: "win-x64", asset: asset("0.7.0/a.exe") },
      t,
    );
    expect(m.releases).toHaveLength(1);
    expect(Object.keys(m.releases[0].platforms).sort()).toEqual(["mac-arm64", "win-x64"]);
  });

  it("keeps releases newest-first and tracks latest vs latestBeta", () => {
    let m = mergeRelease(emptyManifest(), { version: "0.7.0", date: "d", channel: "stable", notesRef: "0.7.0", platform: "mac-arm64", asset: asset("x") }, t);
    m = mergeRelease(m, { version: "0.8.0-beta.1", date: "d", channel: "beta", notesRef: "0.8.0-beta.1", platform: "mac-arm64", asset: asset("y") }, t);
    expect(m.releases.map((r) => r.version)).toEqual(["0.8.0-beta.1", "0.7.0"]);
    expect(m.latest).toBe("0.7.0");
    expect(m.latestBeta).toBe("0.8.0-beta.1");
  });
});

describe("prefixFeedReferences (versioned-subfolder feed fix)", () => {
  const WIN_FEED = [
    "version: 1.4.1",
    "files:",
    "  - url: MUZERO Setup 1.4.1.exe",
    "    sha512: abc==",
    "    size: 128189241",
    "path: MUZERO Setup 1.4.1.exe",
    "sha512: abc==",
    "releaseDate: '2026-06-22T23:12:44.088Z'",
    "",
  ].join("\n");

  const known = new Set(["MUZERO Setup 1.4.1.exe"]);

  it("prefixes url + path with <version>/ so the updater resolves the real binary", () => {
    const out = prefixFeedReferences(WIN_FEED, "1.4.1", known);
    expect(out).toContain("  - url: 1.4.1/MUZERO Setup 1.4.1.exe");
    expect(out).toContain("path: 1.4.1/MUZERO Setup 1.4.1.exe");
  });

  it("leaves version, sha512, size and releaseDate untouched", () => {
    const out = prefixFeedReferences(WIN_FEED, "1.4.1", known);
    expect(out).toContain("version: 1.4.1");
    expect(out).toContain("    size: 128189241");
    expect(out).toContain("releaseDate: '2026-06-22T23:12:44.088Z'");
    expect(out).not.toContain("1.4.1/1.4.1"); // version line must not be double-pathed
  });

  it("is idempotent — already-prefixed refs are not re-prefixed", () => {
    const once = prefixFeedReferences(WIN_FEED, "1.4.1", known);
    const twice = prefixFeedReferences(once, "1.4.1", known);
    expect(twice).toBe(once);
  });

  it("preserves quoting and CRLF line endings", () => {
    const crlf = "path: 'MUZERO Setup 1.4.1.exe'\r\nversion: 1.4.1\r\n";
    const out = prefixFeedReferences(crlf, "1.4.1", known);
    expect(out).toBe("path: '1.4.1/MUZERO Setup 1.4.1.exe'\r\nversion: 1.4.1\r\n");
  });

  it("rewrites every file in a mac feed listing zip + dmg", () => {
    const macFeed = [
      "version: 1.4.1",
      "files:",
      "  - url: MUZERO-1.4.1-arm64-mac.zip",
      "    sha512: a==",
      "  - url: MUZERO-1.4.1-arm64.dmg",
      "    sha512: b==",
      "path: MUZERO-1.4.1-arm64-mac.zip",
      "",
    ].join("\n");
    const out = prefixFeedReferences(
      macFeed,
      "1.4.1",
      new Set(["MUZERO-1.4.1-arm64-mac.zip", "MUZERO-1.4.1-arm64.dmg"]),
    );
    expect(out).toContain("  - url: 1.4.1/MUZERO-1.4.1-arm64-mac.zip");
    expect(out).toContain("  - url: 1.4.1/MUZERO-1.4.1-arm64.dmg");
    expect(out).toContain("path: 1.4.1/MUZERO-1.4.1-arm64-mac.zip");
  });
});

describe("publish-release.mjs --dry-run", () => {
  it("scans installers (skipping feeds/blockmaps) and prints a valid merged manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "muzero-rel-"));
    for (const name of [
      "MUZERO-0.7.0-arm64.dmg",
      "MUZERO Setup 0.7.0.exe",
      "MUZERO-0.7.0-arm64.dmg.blockmap",
      "latest-mac.yml",
    ]) {
      writeFileSync(join(dir, name), "x");
    }
    const out = execFileSync("node", [SCRIPT, "--dry-run", "--dir", dir, "--version", "0.7.0"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const manifest = JSON.parse(out);
    expect(manifest.schema).toBe("muzero-release-manifest-v1");
    expect(manifest.latest).toBe("0.7.0");
    expect(Object.keys(manifest.releases[0].platforms).sort()).toEqual(["mac-arm64", "win-x64"]);
    expect(manifest.releases[0].platforms["mac-arm64"].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.releases[0].platforms["win-x64"].url).toContain("/0.7.0/");
  });
});

import { describe, expect, it } from "vitest";
import { compareSemver } from "@/lib/compare-semver";
import { changelog, latestVersion } from "./index";
import {
  CHANGELOG_AREAS,
  CHANGELOG_CATEGORIES,
  CHANGELOG_LOCALES,
  CHANGELOG_PLATFORMS,
} from "./types";

// Keyed glob so we can assert filename === version.
const keyed = import.meta.glob<{ version: string }>("./releases/*.ts", {
  eager: true,
  import: "default",
});

describe("changelog loader", () => {
  it("loads the backfilled releases", () => {
    expect(changelog.length).toBeGreaterThanOrEqual(7);
  });

  it("is sorted newest-first and latestVersion is the head", () => {
    for (let i = 0; i < changelog.length - 1; i++) {
      expect(compareSemver(changelog[i].version, changelog[i + 1].version)).toBe(1);
    }
    expect(latestVersion).toBe(changelog[0].version);
  });

  it("the newest backfilled release is 0.7.0", () => {
    expect(latestVersion).toBe("0.7.0");
  });

  it("every release version is valid, unique, and matches its filename", () => {
    const seen = new Set<string>();
    for (const [path, mod] of Object.entries(keyed)) {
      const fromName = path.replace(/^.*\/(.+)\.ts$/, "$1");
      expect(mod.version, `filename ${path} must equal its version field`).toBe(fromName);
      expect(mod.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(seen.has(mod.version), `duplicate version ${mod.version}`).toBe(false);
      seen.add(mod.version);
    }
  });
});

describe("changelog content invariants", () => {
  it("each release has a 4-locale title + summary (Q6: no pending translation)", () => {
    for (const release of changelog) {
      for (const loc of CHANGELOG_LOCALES) {
        expect(release.title[loc], `${release.version} title.${loc}`).toBeTruthy();
        expect(release.summary?.[loc], `${release.version} summary.${loc}`).toBeTruthy();
      }
    }
  });

  it("each item has valid enums + a 4-locale title and description", () => {
    for (const release of changelog) {
      expect(release.items.length).toBeGreaterThan(0);
      for (const item of release.items) {
        expect(CHANGELOG_AREAS).toContain(item.area);
        expect(CHANGELOG_CATEGORIES).toContain(item.category);
        expect(CHANGELOG_PLATFORMS).toContain(item.platform);
        for (const loc of CHANGELOG_LOCALES) {
          expect(
            item.title[loc],
            `${release.version} "${item.title.en}" title.${loc}`,
          ).toBeTruthy();
          expect(
            item.description?.[loc],
            `${release.version} "${item.title.en}" description.${loc}`,
          ).toBeTruthy();
        }
      }
    }
  });
});

import { describe, expect, it } from "vitest";
import { compareSemver, isNewerVersion, parseSemver } from "@/lib/compare-semver";

describe("parseSemver", () => {
  it("parses a plain release", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it("tolerates a leading v", () => {
    expect(parseSemver("v0.7.0")).toEqual({ major: 0, minor: 7, patch: 0, prerelease: [] });
  });

  it("splits prerelease identifiers, keeping numerics as numbers", () => {
    expect(parseSemver("0.8.0-beta.1")).toEqual({
      major: 0,
      minor: 8,
      patch: 0,
      prerelease: ["beta", 1],
    });
  });

  it("throws on a malformed version", () => {
    expect(() => parseSemver("1.2")).toThrow();
    expect(() => parseSemver("not.a.version")).toThrow();
  });
});

describe("compareSemver", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareSemver("1.0.0", "1.0.1")).toBe(-1);
    expect(compareSemver("1.0.1", "1.1.0")).toBe(-1);
    expect(compareSemver("1.1.0", "2.0.0")).toBe(-1);
    expect(compareSemver("2.0.0", "1.9.9")).toBe(1);
  });

  it("treats equal versions as 0", () => {
    expect(compareSemver("0.7.0", "0.7.0")).toBe(0);
    expect(compareSemver("v0.7.0", "0.7.0")).toBe(0);
  });

  it("ranks a prerelease BELOW its release (the beta-channel rule)", () => {
    expect(compareSemver("0.8.0-beta.1", "0.8.0")).toBe(-1);
    expect(compareSemver("0.8.0", "0.8.0-beta.1")).toBe(1);
  });

  it("orders prereleases by identifier (numeric < numeric, fewer < more)", () => {
    expect(compareSemver("0.8.0-beta.1", "0.8.0-beta.2")).toBe(-1);
    expect(compareSemver("0.8.0-alpha.1", "0.8.0-beta.1")).toBe(-1);
    expect(compareSemver("0.8.0-beta", "0.8.0-beta.1")).toBe(-1);
  });

  it("ranks numeric identifiers below alphanumeric ones (semver §11)", () => {
    expect(compareSemver("0.8.0-1", "0.8.0-alpha")).toBe(-1);
  });

  it("can drive a newest-first sort", () => {
    const sorted = ["0.7.0", "0.10.0", "0.8.0-beta.1", "0.8.0", "0.9.0"].sort((a, b) =>
      compareSemver(b, a),
    );
    expect(sorted).toEqual(["0.10.0", "0.9.0", "0.8.0", "0.8.0-beta.1", "0.7.0"]);
  });
});

describe("isNewerVersion", () => {
  it("is true when the candidate outranks the base", () => {
    expect(isNewerVersion("0.8.0", "0.7.0")).toBe(true);
    expect(isNewerVersion("0.7.0", "0.8.0")).toBe(false);
    expect(isNewerVersion("0.7.0", "0.7.0")).toBe(false);
  });

  it("treats a null/empty base as 'everything is newer' (first-ever install)", () => {
    expect(isNewerVersion("0.1.0", null)).toBe(true);
    expect(isNewerVersion("0.1.0", undefined)).toBe(true);
    expect(isNewerVersion("0.1.0", "")).toBe(true);
  });
});

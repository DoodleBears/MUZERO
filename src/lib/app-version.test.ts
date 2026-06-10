import { describe, expect, it } from "vitest";
import { APP_VERSION, BUILD_TIME, GIT_SHA, RELEASE_ID } from "@/lib/app-version";
import pkg from "../../package.json";

describe("app-version", () => {
  it("APP_VERSION equals package.json version (single source of truth)", () => {
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exposes a git sha and build time", () => {
    expect(typeof GIT_SHA).toBe("string");
    expect(GIT_SHA.length).toBeGreaterThan(0);
    expect(typeof BUILD_TIME).toBe("string");
  });

  it("RELEASE_ID combines version + sha for support/diagnostics", () => {
    expect(RELEASE_ID).toContain(APP_VERSION);
    expect(RELEASE_ID).toContain(GIT_SHA);
  });
});

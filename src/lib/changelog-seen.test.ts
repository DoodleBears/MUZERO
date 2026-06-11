import { beforeEach, describe, expect, it } from "vitest";
import type { ChangelogRelease } from "@/content/changelog/types";
import {
  getLastSeenVersion,
  latestOf,
  resolveChangelogAutoOpen,
  setLastSeenVersion,
} from "@/lib/changelog-seen";

function rel(version: string): ChangelogRelease {
  return { version, date: "2026-06-11", title: { en: version }, items: [] };
}

// Intentionally unsorted to prove the resolver doesn't assume input order.
const RELEASES = [rel("0.6.0"), rel("0.7.0"), rel("0.5.0")];

describe("latestOf", () => {
  it("finds the newest regardless of input order", () => {
    expect(latestOf(RELEASES)).toBe("0.7.0");
  });
  it("returns null for an empty list", () => {
    expect(latestOf([])).toBeNull();
  });
});

describe("resolveChangelogAutoOpen", () => {
  it("first-ever install: seeds lastSeen to latest and does NOT open (no backlog wall)", () => {
    const d = resolveChangelogAutoOpen(RELEASES, null);
    expect(d.open).toBe(false);
    expect(d.unseen).toEqual([]);
    expect(d.seedLastSeen).toBe("0.7.0");
  });

  it("returning visit with a gap: opens with all unseen releases, newest-first", () => {
    const d = resolveChangelogAutoOpen(RELEASES, "0.5.0");
    expect(d.open).toBe(true);
    expect(d.unseen.map((r) => r.version)).toEqual(["0.7.0", "0.6.0"]);
    expect(d.seedLastSeen).toBeNull();
  });

  it("already up to date: does not open", () => {
    const d = resolveChangelogAutoOpen(RELEASES, "0.7.0");
    expect(d.open).toBe(false);
    expect(d.unseen).toEqual([]);
  });

  it("empty changelog: never opens", () => {
    expect(resolveChangelogAutoOpen([], null)).toEqual({
      open: false,
      unseen: [],
      seedLastSeen: null,
    });
  });
});

describe("localStorage helpers", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips the last-seen version", () => {
    expect(getLastSeenVersion()).toBeNull();
    setLastSeenVersion("0.7.0");
    expect(getLastSeenVersion()).toBe("0.7.0");
  });
});

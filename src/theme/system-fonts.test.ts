import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetSystemFontsCache, loadSystemFonts } from "./system-fonts";

describe("loadSystemFonts", () => {
  afterEach(() => {
    __resetSystemFontsCache();
    vi.unstubAllGlobals();
  });

  it("uses queryLocalFonts when available, deduped (case-insensitive) + sorted", async () => {
    vi.stubGlobal(
      "queryLocalFonts",
      vi
        .fn()
        .mockResolvedValue([{ family: "Helvetica" }, { family: "Arial" }, { family: "helvetica" }]),
    );
    expect(await loadSystemFonts()).toEqual(["Arial", "Helvetica"]);
  });

  it("caches the result so it queries at most once", async () => {
    const query = vi.fn().mockResolvedValue([{ family: "Arial" }]);
    vi.stubGlobal("queryLocalFonts", query);
    await loadSystemFonts();
    await loadSystemFonts();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent calls into a single in-flight query", async () => {
    const query = vi.fn().mockResolvedValue([{ family: "Arial" }]);
    vi.stubGlobal("queryLocalFonts", query);
    await Promise.all([loadSystemFonts(), loadSystemFonts()]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("falls back without throwing when queryLocalFonts is denied", async () => {
    vi.stubGlobal("queryLocalFonts", vi.fn().mockRejectedValue(new Error("denied")));
    // jsdom has no real canvas metrics, so probing yields []; the point is it
    // resolves to an array instead of rejecting.
    expect(Array.isArray(await loadSystemFonts())).toBe(true);
  });

  it("returns an array when no font API is present", async () => {
    expect(Array.isArray(await loadSystemFonts())).toBe(true);
  });
});

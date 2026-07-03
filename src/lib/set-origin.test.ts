import { describe, expect, it } from "vitest";
import type { DjSession } from "@/db/types";
import { filterSetsByOrigin, resolveSetOrigin } from "./set-origin";

const set = (over: Partial<DjSession>): DjSession =>
  ({
    id: "s",
    name: "S",
    seedPrompt: "",
    trackIds: [],
    status: "idle",
    config: {
      autoExtend: true,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 60,
      allowVocals: true,
    },
    displayMode: "cover",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as DjSession;

describe("resolveSetOrigin", () => {
  it("prefers the explicit origin stamp", () => {
    expect(
      resolveSetOrigin(set({ origin: "ai", streamPlaylistRef: { source: "bili", id: "x" } })),
    ).toBe("ai");
    expect(resolveSetOrigin(set({ origin: "human", seedPrompt: "late night jazz" }))).toBe("human");
  });

  it("infers imported from streamPlaylistRef or cloudSource", () => {
    expect(resolveSetOrigin(set({ streamPlaylistRef: { source: "netease", id: "p1" } }))).toBe(
      "imported",
    );
    expect(resolveSetOrigin(set({ cloudSource: { driveId: "d1" } }))).toBe("imported");
  });

  it("infers ai from a non-empty seedPrompt", () => {
    expect(resolveSetOrigin(set({ seedPrompt: "  rainy lofi  " }))).toBe("ai");
  });

  it("infers human otherwise (no seed, not imported) — ignoring the default autoExtend", () => {
    expect(
      resolveSetOrigin(set({ seedPrompt: "", config: { ...set({}).config, autoExtend: true } })),
    ).toBe("human");
    expect(resolveSetOrigin(set({ seedPrompt: "   " }))).toBe("human");
  });
});

describe("filterSetsByOrigin", () => {
  const sessions = [
    set({ id: "ai1", seedPrompt: "vibe" }),
    set({ id: "hum1", seedPrompt: "" }),
    set({ id: "imp1", streamPlaylistRef: { source: "youtube", id: "pl" } }),
    set({ id: "ai2", origin: "ai", seedPrompt: "" }),
  ];

  it("passes everything for 'all' / undefined", () => {
    expect(filterSetsByOrigin(sessions, "all")).toHaveLength(4);
    expect(filterSetsByOrigin(sessions, undefined)).toHaveLength(4);
  });

  it("filters by each origin", () => {
    expect(filterSetsByOrigin(sessions, "ai").map((s) => s.id)).toEqual(["ai1", "ai2"]);
    expect(filterSetsByOrigin(sessions, "human").map((s) => s.id)).toEqual(["hum1"]);
    expect(filterSetsByOrigin(sessions, "imported").map((s) => s.id)).toEqual(["imp1"]);
  });
});

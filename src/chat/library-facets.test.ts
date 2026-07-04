import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { applyTagEditToCounts, computeFacets } from "./library-facets";

function track(over: Partial<Track> & { id: string }): Track {
  return {
    sessionId: "ses_1",
    title: "Song",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 100,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...over,
  };
}

describe("computeFacets", () => {
  it("counts each genre once per track, merging file genres ∪ enrichment (case-insensitive)", () => {
    const tracks = [
      track({
        id: "a",
        mediaMetadata: { genres: ["Pop"], artists: [], parser: "music-metadata", parsedAt: 0 },
      }),
      track({
        id: "b",
        mediaMetadata: {
          genres: ["pop", "Rock"],
          artists: [],
          parser: "music-metadata",
          parsedAt: 0,
        },
      }),
      track({ id: "c" }), // genre only from enrichment
    ];
    const enrich = new Map<string, string[]>([
      ["a", ["pop"]], // duplicate of file "Pop" → still one track for "pop"
      ["c", ["rock", "city pop"]],
    ]);
    const { genres } = computeFacets(tracks, enrich);
    expect(genres).toEqual([
      { name: "pop", count: 2 }, // a + b (a's file+enrichment dup collapses)
      { name: "rock", count: 2 }, // b + c
      { name: "city pop", count: 1 },
    ]);
  });

  it("counts tags once per track", () => {
    const { tags } = computeFacets(
      [
        track({ id: "a", tags: ["roadtrip", "chill"] }),
        track({ id: "b", tags: ["roadtrip"] }),
        track({ id: "c", tags: ["roadtrip", "roadtrip"] }), // dup within a track → one
      ],
      new Map(),
    );
    expect(tags).toEqual([
      { name: "roadtrip", count: 3 },
      { name: "chill", count: 1 },
    ]);
  });

  it("sorts by count desc then name asc, and caps to the limit", () => {
    const tracks = [
      track({ id: "a", tags: ["z"] }),
      track({ id: "b", tags: ["z"] }),
      track({ id: "c", tags: ["a"] }),
      track({ id: "d", tags: ["m"] }),
    ];
    const { tags } = computeFacets(tracks, new Map(), { limit: 2 });
    expect(tags).toEqual([
      { name: "z", count: 2 },
      { name: "a", count: 1 }, // "a" before "m" on the count-1 tie
    ]);
  });

  it("is empty-safe", () => {
    expect(computeFacets([], new Map())).toEqual({ genres: [], tags: [] });
  });
});

describe("applyTagEditToCounts", () => {
  it("increments added, decrements removed, leaves shared untouched, deletes at zero", () => {
    const counts = new Map([
      ["a", 2],
      ["b", 1],
    ]);
    applyTagEditToCounts(counts, ["a", "b"], ["a", "c"]); // keep a, remove b, add c
    expect(counts.get("a")).toBe(2);
    expect(counts.has("b")).toBe(false); // 1 → 0 → deleted
    expect(counts.get("c")).toBe(1);
  });

  it("no-ops when the tag set is unchanged", () => {
    const counts = new Map([["a", 3]]);
    applyTagEditToCounts(counts, ["a"], ["a"]);
    expect(counts.get("a")).toBe(3);
  });
});

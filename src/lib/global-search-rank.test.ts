import { describe, expect, it } from "vitest";
import { rankGlobalSearchBestMatches } from "./global-search-rank";

describe("rankGlobalSearchBestMatches", () => {
  it("lets a strong artist match beat a weaker track match despite type bias", () => {
    const ranked = rankGlobalSearchBestMatches([
      { key: "track:buried", kind: "track", order: 0, score: 12 },
      { key: "artist:exact", kind: "artist", order: 1, score: 0 },
    ]);

    expect(ranked.map((item) => item.key)).toEqual(["artist:exact", "track:buried"]);
  });

  it("puts an exact artist entity before tracks whose artist field merely shares the exact score", () => {
    const ranked = rankGlobalSearchBestMatches([
      { exactness: 1, key: "track:song-by-supercell", kind: "track", order: 0, score: 0 },
      { exactness: 2, key: "artist:supercell", kind: "artist", order: 1, score: 0 },
    ]);

    expect(ranked.map((item) => item.key)).toEqual(["artist:supercell", "track:song-by-supercell"]);
  });

  it("keeps an exact track-title match ahead of an exact artist entity", () => {
    const ranked = rankGlobalSearchBestMatches([
      { exactness: 3, key: "track:title-supercell", kind: "track", order: 0, score: 0 },
      { exactness: 2, key: "artist:supercell", kind: "artist", order: 1, score: 0 },
    ]);

    expect(ranked.map((item) => item.key)).toEqual(["track:title-supercell", "artist:supercell"]);
  });

  it("deduplicates by key, keeps the best duplicate, and honors the limit", () => {
    const ranked = rankGlobalSearchBestMatches(
      [
        { key: "track:a", kind: "track", order: 0, score: 9 },
        { key: "track:a", kind: "track", order: 1, score: 1 },
        { key: "album:b", kind: "album", order: 2, score: 0 },
      ],
      2,
    );

    expect(ranked).toEqual([
      { key: "track:a", kind: "track", order: 1, score: 1 },
      { key: "album:b", kind: "album", order: 2, score: 0 },
    ]);
  });
});

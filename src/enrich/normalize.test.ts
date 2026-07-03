import { describe, expect, it } from "vitest";
import { normalizeGenre, normalizeGenres, primaryArtist } from "./normalize";

describe("normalizeGenre", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeGenre("  Pop  ")).toBe("pop");
    expect(normalizeGenre("Alternative  Rock")).toBe("alternative rock");
  });

  it("canonicalizes synonyms", () => {
    expect(normalizeGenre("Hip-Hop")).toBe("hip hop");
    expect(normalizeGenre("rap")).toBe("hip hop");
    expect(normalizeGenre("RnB")).toBe("r&b");
    expect(normalizeGenre("alt rock")).toBe("alternative rock");
    expect(normalizeGenre("synthpop")).toBe("synth-pop");
    expect(normalizeGenre("EDM")).toBe("electronic");
    expect(normalizeGenre("jpop")).toBe("j-pop");
    expect(normalizeGenre("cpop")).toBe("c-pop");
    expect(normalizeGenre("mandarin pop")).toBe("mandopop");
  });

  it("maps Chinese-style aliases to a single canonical genre", () => {
    expect(normalizeGenre("zhongguo feng")).toBe("中国风");
    expect(normalizeGenre("guofeng")).toBe("中国风");
    expect(normalizeGenre("古风")).toBe("中国风");
  });

  it("maps video-game aliases to soundtrack and drops franchise/role noise (real MB tags)", () => {
    expect(normalizeGenre("VGM")).toBe("soundtrack");
    expect(normalizeGenre("video game music")).toBe("soundtrack");
    for (const t of ["composer", "hoyoverse", "miHoYo", "gacha game", "ai-generated"]) {
      expect(normalizeGenre(t)).toBeNull();
    }
  });

  it("keeps already-canonical genres untouched", () => {
    for (const g of ["mandopop", "cantopop", "j-pop", "r&b", "soul", "rock", "中国风"]) {
      expect(normalizeGenre(g)).toBe(g);
    }
  });

  it("drops decade / bare-year tags", () => {
    for (const t of ["80s", "1990s", "2010s", "2000", "2023"]) {
      expect(normalizeGenre(t)).toBeNull();
    }
  });

  it("drops personal / listening / vocal / origin noise", () => {
    for (const t of [
      "favorites",
      "seen live",
      "female vocalists",
      "beautiful",
      "chinese",
      "english",
    ]) {
      expect(normalizeGenre(t)).toBeNull();
    }
  });

  it("drops empty and over-long tags", () => {
    expect(normalizeGenre("")).toBeNull();
    expect(normalizeGenre("   ")).toBeNull();
    expect(normalizeGenre("a".repeat(41))).toBeNull();
  });
});

describe("normalizeGenres", () => {
  it("normalizes, de-dupes (post-canonicalization), and preserves first-seen order", () => {
    expect(normalizeGenres(["Pop", "hip-hop", "Rap", "R&B", "rnb"])).toEqual([
      "pop",
      "hip hop",
      "r&b",
    ]);
  });

  it("strips noise while keeping real genres", () => {
    expect(normalizeGenres(["mandopop", "2010s", "female vocalists", "中国风", "chinese"])).toEqual(
      ["mandopop", "中国风"],
    );
  });

  it("caps the output length", () => {
    const many = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(normalizeGenres(many, 3)).toEqual(["a", "b", "c"]);
  });

  it("returns [] for all-noise input", () => {
    expect(normalizeGenres(["favorites", "2010s", "seen live"])).toEqual([]);
  });
});

describe("primaryArtist", () => {
  it("returns the first-billed artist, dropping collaborators", () => {
    expect(primaryArtist("周杰伦/Montagem")).toBe("周杰伦");
    expect(primaryArtist("Calvin Harris, Dua Lipa")).toBe("Calvin Harris");
    expect(primaryArtist("Jay-Z feat. Alicia Keys")).toBe("Jay-Z");
    expect(primaryArtist("A × B")).toBe("A");
  });

  it("keeps a single clean name intact (incl. dotted names)", () => {
    expect(primaryArtist("G.E.M.")).toBe("G.E.M.");
    expect(primaryArtist("Coldplay")).toBe("Coldplay");
  });
});

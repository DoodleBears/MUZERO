import { describe, expect, it } from "vitest";
import { bucketIndexAt, buildAlphabetIndex, firstAlphaLabel } from "./alphabet-index";

describe("firstAlphaLabel", () => {
  it("uppercases the first latin letter", () => {
    expect(firstAlphaLabel("Apple")).toBe("A");
    expect(firstAlphaLabel("avocado")).toBe("A");
  });

  it("strips diacritics to the base letter", () => {
    expect(firstAlphaLabel("Élan")).toBe("E");
    expect(firstAlphaLabel("Über")).toBe("U");
  });

  it("buckets digits / symbols / empty under #", () => {
    expect(firstAlphaLabel("123")).toBe("#");
    expect(firstAlphaLabel("!!!")).toBe("#");
    expect(firstAlphaLabel("  ")).toBe("#");
    expect(firstAlphaLabel("")).toBe("#");
  });
});

describe("buildAlphabetIndex", () => {
  const letter = (s: string) => firstAlphaLabel(s);

  it("records the first index of each letter group in a sorted list", () => {
    const rows = ["Apple", "Avocado", "Banana", "Cherry", "cucumber"];
    expect(buildAlphabetIndex(rows, letter)).toEqual([
      { label: "A", firstIndex: 0 },
      { label: "B", firstIndex: 2 },
      { label: "C", firstIndex: 3 },
    ]);
  });

  it("handles a leading # group (digits/symbols sort first)", () => {
    const rows = ["1979", "99 Luftballons", "Abbey Road"];
    expect(buildAlphabetIndex(rows, letter)).toEqual([
      { label: "#", firstIndex: 0 },
      { label: "A", firstIndex: 2 },
    ]);
  });

  it("uses an injected letter fn (e.g. transliterated CJK first letter)", () => {
    // 周杰伦 → pinyin Z, あ → A — the component injects the real transliteration.
    const rows = [
      { title: "周杰伦", romaji: "zhou" },
      { title: "Adele", romaji: "adele" },
    ].sort((a, b) => a.romaji.localeCompare(b.romaji));
    const index = buildAlphabetIndex(rows, (r) => firstAlphaLabel(r.romaji));
    expect(index).toEqual([
      { label: "A", firstIndex: 0 },
      { label: "Z", firstIndex: 1 },
    ]);
  });

  it("de-dupes a recurring label to its first occurrence (mis-collated list)", () => {
    // pinyin initials over a list a non-zh runtime collated by Han codepoint: the
    // same letter can reappear far down — show it once, jump to the first.
    const rows = ["Apple", "Zebra", "Avocado"];
    expect(buildAlphabetIndex(rows, letter)).toEqual([
      { label: "A", firstIndex: 0 },
      { label: "Z", firstIndex: 1 },
    ]);
  });

  it("is empty for an empty list", () => {
    expect(buildAlphabetIndex([], letter)).toEqual([]);
  });
});

describe("bucketIndexAt", () => {
  // A tight 27-letter block, 270px tall (10px per letter), starting at y=100.
  const TOP = 100;
  const HEIGHT = 270;
  const COUNT = 27;

  it("maps the pointer to the letter directly under it (no full-height gap overshoot)", () => {
    // Holding the 3rd letter (index 2) — its band is y∈[120,130). This is the
    // B-not-G regression: the finger on B must resolve to B, not a later letter.
    expect(bucketIndexAt(125, TOP, HEIGHT, COUNT)).toBe(2);
    expect(bucketIndexAt(TOP, TOP, HEIGHT, COUNT)).toBe(0); // top edge → first
  });

  it("clamps above the top and below the bottom", () => {
    expect(bucketIndexAt(20, TOP, HEIGHT, COUNT)).toBe(0);
    expect(bucketIndexAt(9999, TOP, HEIGHT, COUNT)).toBe(COUNT - 1);
    expect(bucketIndexAt(TOP + HEIGHT, TOP, HEIGHT, COUNT)).toBe(COUNT - 1);
  });

  it("returns 0 for an empty strip", () => {
    expect(bucketIndexAt(150, TOP, HEIGHT, 0)).toBe(0);
  });
});

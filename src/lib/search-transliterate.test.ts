import { beforeAll, describe, expect, it } from "vitest";
import {
  ensureTransliterationLoaded,
  NO_MATCH_SCORE,
  normalizeSearchText,
  scoreVariants,
  searchVariants,
} from "./search-transliterate";

// The pinyin/wanakana libs load lazily (Worker chunk / dynamic import). Tests
// warm them up once so variant generation is fully synchronous afterwards.
beforeAll(async () => {
  await ensureTransliterationLoaded();
});

describe("normalizeSearchText", () => {
  it("NFKC-folds full-width forms and lowercases", () => {
    expect(normalizeSearchText("ＨＥＬＬＯ")).toBe("hello");
    expect(normalizeSearchText("  Café  ")).toBe("café");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeSearchText("   ")).toBe("");
  });
});

describe("searchVariants — Chinese pinyin", () => {
  it("emits full pinyin (spaced + compact) and initials (spaced + compact)", () => {
    const v = searchVariants("北京欢迎你");
    expect(v).toContain("北京欢迎你"); // original always preserved
    expect(v).toContain("bei jing huan ying ni");
    expect(v).toContain("beijinghuanyingni");
    expect(v).toContain("b j h y n");
    expect(v).toContain("bjhyn");
  });

  it("uses v for ü so both lvxing and the lx initials reach 旅行", () => {
    const v = searchVariants("旅行");
    expect(v).toContain("lvxing");
    expect(v).toContain("lx");
  });

  it("handles mixed latin + Han (iPhone 手机 → …shouji…)", () => {
    const v = searchVariants("iPhone 手机");
    expect(v.some((x) => x.includes("shouji"))).toBe(true);
  });
});

describe("searchVariants — Japanese kana / romaji", () => {
  it("emits hiragana, katakana and romaji (spaced + compact) for kana input", () => {
    const v = searchVariants("じどう ジマク");
    expect(v).toContain("じどうじまく"); // hiragana, compact
    expect(v).toContain("ジドウ ジマク"); // katakana (lowercase no-op on kana)
    expect(v).toContain("jidou jimaku"); // romaji, spaced
    expect(v).toContain("jidoujimaku"); // romaji, compact
  });

  it("romanizes pure-katakana loanwords (ナルト → naruto)", () => {
    expect(searchVariants("ナルト")).toContain("naruto");
  });

  it("kana-first: a kana-containing title skips pinyin (no wrong Chinese reading)", () => {
    // 君/名 are Han, but の/は are kana → kana path wins, pinyin is skipped.
    // wanakana romanizes kana only; kanji pass through (documented limitation).
    const v = searchVariants("君の名は");
    expect(v.some((x) => x.includes("no"))).toBe(true); // の → no
    expect(v.some((x) => x.includes("jun"))).toBe(false); // 君 NOT read as pinyin "jun"
    expect(v.some((x) => x.includes("ming"))).toBe(false); // 名 NOT read as pinyin "ming"
  });
});

describe("scoreVariants — tiered scoring", () => {
  it("orders exact < prefix < substring < subsequence < no-match", () => {
    expect(scoreVariants(["abc"], ["abc"])).toBe(0); // exact
    const prefix = scoreVariants(["abc"], ["abcdef"]);
    const substring = scoreVariants(["cd"], ["abcdef"]);
    const subsequence = scoreVariants(["adf"], ["abcdef"]); // a..d..f with gaps
    expect(prefix).toBeGreaterThan(0);
    expect(prefix).toBeLessThan(substring);
    expect(substring).toBeLessThan(subsequence);
    expect(subsequence).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreVariants(["zzz"], ["abcdef"])).toBe(NO_MATCH_SCORE);
  });

  it("matches pinyin initials and full pinyin through the variant sets", () => {
    const field = searchVariants("北京欢迎你");
    expect(scoreVariants(searchVariants("bjhyn"), field)).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreVariants(searchVariants("beijing"), field)).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreVariants(searchVariants("xyz"), field)).toBe(NO_MATCH_SCORE);
  });

  it("matches romaji query against kana field (jidou → じどう ジマク)", () => {
    expect(scoreVariants(searchVariants("jidou"), searchVariants("じどう ジマク"))).toBeLessThan(
      NO_MATCH_SCORE,
    );
  });
});

describe("subsequence guards", () => {
  it("does not fuzzy-match across very long fields (>96 chars)", () => {
    const longGapped = `a${"z".repeat(50)}c${"z".repeat(50)}e`; // 103 chars, a…c…e subsequence
    expect(scoreVariants(["ace"], [longGapped])).toBe(NO_MATCH_SCORE);
  });

  it("does fuzzy-match the same subsequence in a short field", () => {
    const shortGapped = `a${"z".repeat(5)}c${"z".repeat(5)}e`;
    expect(scoreVariants(["ace"], [shortGapped])).toBeLessThan(NO_MATCH_SCORE);
  });
});

describe("edge cases", () => {
  it("returns no variants for empty input", () => {
    expect(searchVariants("")).toEqual([]);
  });

  it("passes plain latin through with a compacted variant", () => {
    const v = searchVariants("Hello World");
    expect(v).toContain("hello world");
    expect(v).toContain("helloworld");
  });
});

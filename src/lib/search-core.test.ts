import { beforeAll, describe, expect, it } from "vitest";
import {
  freeTextMatches,
  type IndexableRow,
  isEmptyTokens,
  parseSearchTokens,
  queryRows,
  scoreRow,
} from "./search-core";
import { ensureTransliterationLoaded, NO_MATCH_SCORE } from "./search-transliterate";

beforeAll(async () => {
  await ensureTransliterationLoaded();
});

const row = (partial: Partial<IndexableRow> & { id: string }): IndexableRow => ({
  free: [],
  artist: [],
  album: [],
  tags: [],
  ...partial,
});

describe("parseSearchTokens", () => {
  it("splits scoped tokens from free text", () => {
    expect(parseSearchTokens("DoubleJ artist:yumi album:moon #chill")).toEqual({
      free: ["doublej"],
      artist: ["yumi"],
      album: ["moon"],
      tags: ["chill"],
    });
  });

  it("isEmptyTokens detects a blank query", () => {
    expect(isEmptyTokens(parseSearchTokens("   "))).toBe(true);
    expect(isEmptyTokens(parseSearchTokens("hi"))).toBe(false);
  });
});

describe("scoreRow", () => {
  const cn = row({ id: "cn", free: ["北京欢迎你"], tags: ["旅行"] });

  it("matches free text by pinyin (lower score = better)", () => {
    expect(scoreRow(cn, parseSearchTokens("beijing"))).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreRow(cn, parseSearchTokens("bjhyn"))).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreRow(cn, parseSearchTokens("shanghai"))).toBe(NO_MATCH_SCORE);
  });

  it("scopes tags / artist / album", () => {
    expect(scoreRow(cn, parseSearchTokens("#lvxing"))).toBeLessThan(NO_MATCH_SCORE);
    const jp = row({ id: "jp", artist: ["周杰伦"], album: ["范特西"] });
    expect(scoreRow(jp, parseSearchTokens("artist:zhoujielun"))).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreRow(jp, parseSearchTokens("album:fantexi"))).toBeLessThan(NO_MATCH_SCORE);
    expect(scoreRow(jp, parseSearchTokens("artist:nobody"))).toBe(NO_MATCH_SCORE);
  });

  it("returns 0 for an empty query", () => {
    expect(scoreRow(cn, parseSearchTokens(""))).toBe(0);
  });
});

describe("queryRows", () => {
  const rows: IndexableRow[] = [
    row({ id: "buried", free: ["Long Distance", "a long drive home"] }),
    row({ id: "exact", free: ["Drive"] }),
  ];

  it("filters non-matches and ranks best-first (stable for ties)", () => {
    expect(queryRows(rows, "drive").map((h) => h.id)).toEqual(["exact", "buried"]);
    expect(queryRows(rows, "zzz")).toEqual([]);
  });

  it("returns all rows (score 0, input order) for an empty query", () => {
    expect(queryRows(rows, "").map((h) => h.id)).toEqual(["buried", "exact"]);
  });

  it("carries a numeric score with each hit", () => {
    const [first] = queryRows(rows, "drive");
    expect(first.id).toBe("exact");
    expect(first.score).toBe(0); // exact title match
  });
});

describe("freeTextMatches", () => {
  it("matches by substring and is multi-token AND", () => {
    expect(freeTextMatches("", ["Play / Pause"])).toBe(true);
    expect(freeTextMatches("play", ["Play / Pause", "pause"])).toBe(true);
    expect(freeTextMatches("play pause", ["Play / Pause"])).toBe(true);
    expect(freeTextMatches("play stop", ["Play / Pause"])).toBe(false);
    expect(freeTextMatches("zzz", ["Play / Pause"])).toBe(false);
  });

  it("matches Chinese via pinyin once the dictionaries load", async () => {
    await ensureTransliterationLoaded();
    expect(freeTextMatches("shangyishou", ["上一首"])).toBe(true);
    expect(freeTextMatches("sys", ["上一首"])).toBe(true); // 首字母 initials
  });
});

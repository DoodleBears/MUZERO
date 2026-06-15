import { beforeAll, describe, expect, it } from "vitest";
import { type IndexableRow, type QueryHit, queryRows } from "@/lib/search-core";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import { buildIndexedRow, createSearchIndex } from "./search-index";

beforeAll(async () => {
  await ensureTransliterationLoaded();
});

const row = (id: string, partial: Partial<Omit<IndexableRow, "id">> = {}): IndexableRow => ({
  id,
  free: [],
  artist: [],
  album: [],
  tags: [],
  ...partial,
});

// A corpus that exercises every tier + transliteration path the scorer supports.
const CORPUS: IndexableRow[] = [
  row("cn", { free: ["北京欢迎你"] }),
  row("jp", { free: ["ナルト"] }),
  row("en", { free: ["Twilight Sparkle"], artist: ["Daniel"], album: ["Moonrise"] }),
  row("tagged", { free: ["Lofi beat"], tags: ["chill", "study"] }),
  row("mixed", { free: ["iPhone手机"], artist: ["周杰伦"] }),
  row("empty", { free: ["unrelated text"] }),
];

const QUERIES = [
  "", // empty → all rows, input order
  "beijing", // full pinyin
  "bjhyn", // pinyin initials
  "naruto", // romaji
  "twilight", // exact-ish latin
  "wili", // subsequence of twilight? (fuzzy)
  "light", // substring (mid-word)
  "artist:daniel",
  "album:moon", // prefix on album
  "#chill", // tag scope
  "zhoujielun", // pinyin of 周杰伦 via artist field
  "zzzznomatch",
];

describe("queryIndexedRows parity with queryRows", () => {
  it("returns identical ranked ids for every query (precomputed variants ≡ live scan)", () => {
    const index = createSearchIndex();
    index.setRows(CORPUS);
    for (const q of QUERIES) {
      const expected = queryRows(CORPUS, q);
      const actual = index.query(q);
      expect(actual, `query ${JSON.stringify(q)}`).toEqual(expected);
    }
  });

  it("buildIndexedRow stores per-field variant arrays (no live transliteration on query)", () => {
    const indexed = buildIndexedRow(row("x", { free: ["北京"], tags: ["chill"] }));
    expect(indexed.id).toBe("x");
    expect(indexed.free.length).toBe(1);
    // pinyin variants of 北京 include "beijing" / "bei jing" / "bj"
    expect(indexed.free[0]).toContain("beijing");
  });
});

const sortHits = (hits: QueryHit[]): QueryHit[] =>
  [...hits].sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));

describe("createSearchIndex incremental maintenance ≡ full rebuild", () => {
  it("add/remove/update reach the same index a full rebuild would (no full re-transliteration)", () => {
    const incremental = createSearchIndex();
    // Build piecemeal, then mutate.
    incremental.addRow(row("cn", { free: ["北京欢迎你"] }));
    incremental.addRow(row("jp", { free: ["ナルト"] }));
    incremental.addRow(row("temp", { free: ["delete me"] }));
    incremental.removeRow("temp");
    incremental.addRow(row("en", { free: ["WRONG"], artist: ["Daniel"], album: ["Moonrise"] }));
    incremental.updateRow(
      row("en", { free: ["Twilight Sparkle"], artist: ["Daniel"], album: ["Moonrise"] }),
    );
    incremental.addRow(row("tagged", { free: ["Lofi beat"], tags: ["chill", "study"] }));
    incremental.addRow(row("mixed", { free: ["iPhone手机"], artist: ["周杰伦"] }));
    incremental.addRow(row("empty", { free: ["unrelated text"] }));

    const fresh = createSearchIndex();
    fresh.setRows(CORPUS);

    for (const q of QUERIES) {
      expect(sortHits(incremental.query(q)), `query ${JSON.stringify(q)}`).toEqual(
        sortHits(fresh.query(q)),
      );
    }
  });

  it("setRows reuses unchanged rows and only rebuilds the delta", () => {
    const index = createSearchIndex();
    const first = index.setRows(CORPUS);
    expect(first.added).toBe(CORPUS.length);
    expect(first.reused).toBe(0);

    // Same array again → everything reused, nothing rebuilt.
    const second = index.setRows(CORPUS);
    expect(second.reused).toBe(CORPUS.length);
    expect(second.added).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.removed).toBe(0);

    // Change one row, drop one, add one.
    const next: IndexableRow[] = [
      row("cn", { free: ["北京欢迎你"] }), // unchanged
      row("jp", { free: ["サスケ"] }), // changed
      row("en", { free: ["Twilight Sparkle"], artist: ["Daniel"], album: ["Moonrise"] }), // unchanged
      row("tagged", { free: ["Lofi beat"], tags: ["chill", "study"] }), // unchanged
      row("mixed", { free: ["iPhone手机"], artist: ["周杰伦"] }), // unchanged
      row("newbie", { free: ["fresh row"] }), // added; "empty" removed
    ];
    const third = index.setRows(next);
    expect(third.added).toBe(1); // newbie
    expect(third.updated).toBe(1); // jp
    expect(third.removed).toBe(1); // empty
    expect(third.reused).toBe(4);
    expect(index.size()).toBe(6);
  });

  it("removeRow drops a row from results", () => {
    const index = createSearchIndex();
    index.setRows(CORPUS);
    expect(index.query("naruto").map((h) => h.id)).toEqual(["jp"]);
    index.removeRow("jp");
    expect(index.query("naruto")).toEqual([]);
  });
});

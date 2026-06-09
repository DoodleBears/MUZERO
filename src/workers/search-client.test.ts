import { beforeAll, describe, expect, it } from "vitest";
import type { IndexableRow } from "@/lib/search-core";
import { ensureTransliterationLoaded } from "@/lib/search-transliterate";
import { __resetSearchClientForTests, searchRows, setSearchRows } from "./search-client";

// jsdom has no Worker; remove it explicitly so the client takes the inline
// fallback deterministically (the Worker path is thin glue, untested like
// heavy-worker — the matcher itself is covered in search-core.test).
beforeAll(async () => {
  (globalThis as { Worker?: unknown }).Worker = undefined;
  await ensureTransliterationLoaded();
  __resetSearchClientForTests();
});

const row = (id: string, free: string[]): IndexableRow => ({
  id,
  free,
  artist: [],
  album: [],
  tags: [],
});

describe("search-client inline fallback", () => {
  it("ranks pinyin / romaji matches over the pushed row mirror", async () => {
    setSearchRows([row("cn", ["北京欢迎你"]), row("jp", ["ナルト"]), row("other", ["unrelated"])]);
    expect((await searchRows("bjhyn")).map((h) => h.id)).toEqual(["cn"]);
    expect((await searchRows("beijing")).map((h) => h.id)).toEqual(["cn"]);
    expect((await searchRows("naruto")).map((h) => h.id)).toEqual(["jp"]);
    expect(await searchRows("zzz")).toEqual([]);
  });

  it("returns every row (input order) for an empty query", async () => {
    setSearchRows([row("a", ["x"]), row("b", ["y"])]);
    expect((await searchRows("")).map((h) => h.id)).toEqual(["a", "b"]);
  });
});

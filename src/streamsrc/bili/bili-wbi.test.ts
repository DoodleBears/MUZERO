import { describe, expect, it } from "vitest";
import { deriveMixinKey, extractWbiKeyFromUrl, signWbi, WBI_MIXIN_INDEX } from "./bili-wbi";

/**
 * Vectors are the canonical WBI example documented in
 * SocialSisterYi/bilibili-API-collect (the de-facto reference). Pinning them means
 * a refactor of the mixin-rerank or the query/md5 assembly can't silently break the
 * signature the server validates.
 */
const IMG_KEY = "7cd084941338484aae1ad9425b84077c";
const SUB_KEY = "4932caff0ff746eab6f01bf08b70ac45";
const MIXIN_KEY = "ea1db124af3c7062474693fa704f4ff8";

describe("WBI_MIXIN_INDEX", () => {
  it("is the 64-entry rerank table (each index 0..63 exactly once)", () => {
    expect(WBI_MIXIN_INDEX).toHaveLength(64);
    expect([...WBI_MIXIN_INDEX].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 64 }, (_, i) => i),
    );
  });
});

describe("extractWbiKeyFromUrl", () => {
  it("takes the filename without extension from a wbi img/sub url", () => {
    expect(extractWbiKeyFromUrl(`https://i0.hdslb.com/bfs/wbi/${IMG_KEY}.png`)).toBe(IMG_KEY);
    expect(extractWbiKeyFromUrl(`https://i0.hdslb.com/bfs/wbi/${SUB_KEY}.png`)).toBe(SUB_KEY);
  });
});

describe("deriveMixinKey", () => {
  it("reranks imgKey+subKey by MIXIN_INDEX and truncates to 32 chars", () => {
    expect(deriveMixinKey(IMG_KEY, SUB_KEY)).toBe(MIXIN_KEY);
  });
});

describe("signWbi", () => {
  it("sorts params, appends wts, and computes w_rid = md5(query + mixinKey)", () => {
    const signed = signWbi({ foo: "114", bar: "514", baz: 1919810 }, MIXIN_KEY, 1702204169);
    expect(signed.query).toBe("bar=514&baz=1919810&foo=114&wts=1702204169");
    // md5(query + mixinKey); cross-checked against Node's crypto.createHash("md5").
    expect(signed.wRid).toBe("6149fdadf571698ca7e6a567265cd0ee");
    expect(signed.params.w_rid).toBe(signed.wRid);
    expect(signed.params.wts).toBe("1702204169");
  });

  it("strips !'()* from values before signing (bilibili filterValue rule)", () => {
    const signed = signWbi({ name: "a!b'c(d)e*f" }, MIXIN_KEY, 1702204169);
    // The signed query must carry the filtered value, not the raw one.
    expect(signed.query).toContain("name=abcdef");
    expect(signed.query).not.toContain("!");
  });

  it("is deterministic for a fixed wts", () => {
    const a = signWbi({ q: "test" }, MIXIN_KEY, 1700000000);
    const b = signWbi({ q: "test" }, MIXIN_KEY, 1700000000);
    expect(a.wRid).toBe(b.wRid);
  });
});

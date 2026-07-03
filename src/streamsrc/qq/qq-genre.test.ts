import { describe, expect, it } from "vitest";
import { parseQqNativeGenre } from "./qq-genre";

// Real `get_song_detail_yqq` shape captured via the enrich-probe E2E (稻香): genre + language
// live under `songinfo.data.info` as `{ title, content:[{ value }] }` blocks.
const REAL = {
  songinfo: {
    data: {
      track_info: { genre: 1, language: 0 },
      info: {
        genre: { title: "歌曲流派", content: [{ id: 40, value: "Pop" }] },
        lan: { title: "歌曲语种", content: [{ id: 1, value: "国语" }] },
      },
    },
  },
};

describe("parseQqNativeGenre", () => {
  it("extracts human-readable genre + language from info blocks", () => {
    expect(parseQqNativeGenre(REAL)).toEqual({ genres: ["Pop"], language: "国语" });
  });

  it("reads a bare `data.info` shape too (no songinfo wrapper)", () => {
    expect(
      parseQqNativeGenre({ data: { info: { genre: { content: [{ value: "Alternative" }] } } } }),
    ).toEqual({ genres: ["Alternative"], language: undefined });
  });

  it("returns empty genres when the detail has no genre block", () => {
    expect(parseQqNativeGenre({ songinfo: { data: { info: {} } } })).toEqual({
      genres: [],
      language: undefined,
    });
    expect(parseQqNativeGenre(null)).toEqual({ genres: [], language: undefined });
  });
});

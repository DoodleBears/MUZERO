import { describe, expect, it } from "vitest";
import { parseQqSearch, parseQqSongDetail, qqAlbumCover, qqSongToHit } from "./qq-playlists";

describe("qqAlbumCover", () => {
  it("builds the y.qq.com photo url from an album mid", () => {
    expect(qqAlbumCover("002cez1Q")).toBe(
      "https://y.qq.com/music/photo_new/T002R800x800M000002cez1Q.jpg",
    );
  });
});

describe("qqSongToHit", () => {
  it("maps a search list item (songmid/songname/singer/interval seconds)", () => {
    expect(
      qqSongToHit({
        songmid: "001",
        songname: "Song",
        singer: [{ name: "A" }, { name: "B" }],
        albumname: "Album",
        albummid: "ALB",
        interval: 215,
      }),
    ).toEqual({
      source: "qq",
      externalId: "001",
      title: "Song",
      artist: "A/B",
      album: "Album",
      durationSec: 215,
      coverUrl: qqAlbumCover("ALB"),
    });
  });
  it("maps a track_info shape (mid/name/album object)", () => {
    const hit = qqSongToHit({
      mid: "002",
      name: "T",
      singer: [{ name: "S" }],
      album: { name: "AL", mid: "AM" },
      interval: 100,
    });
    expect(hit.externalId).toBe("002");
    expect(hit.album).toBe("AL");
    expect(hit.coverUrl).toBe(qqAlbumCover("AM"));
  });
});

describe("parseQqSearch", () => {
  it("reads data.song.list and drops items without a mid", () => {
    const hits = parseQqSearch({
      data: { song: { list: [{ songmid: "1", songname: "a" }, { songname: "no-mid" }] } },
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].externalId).toBe("1");
  });
  it("returns [] for unexpected shapes", () => {
    expect(parseQqSearch(null)).toEqual([]);
    expect(parseQqSearch({})).toEqual([]);
  });
});

describe("parseQqSongDetail", () => {
  it("reads songinfo.data.track_info", () => {
    expect(
      parseQqSongDetail({ songinfo: { data: { track_info: { mid: "9", name: "n" } } } })
        ?.externalId,
    ).toBe("9");
  });
  it("returns null when track_info is missing", () => {
    expect(parseQqSongDetail({})).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  parseQqPlaylistMeta,
  parseQqPlaylistTracks,
  parseQqSearch,
  parseQqSongDetail,
  qqAlbumCover,
  qqSongToHit,
} from "./qq-playlists";

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

describe("parseQqPlaylistMeta", () => {
  it("reads dirinfo (modern aiDissInfo)", () => {
    expect(
      parseQqPlaylistMeta({
        req_0: {
          data: {
            dirinfo: { id: 9069454695, title: "List", picurl: "http://x/p.jpg", songnum: 42 },
          },
        },
      }),
    ).toEqual({
      id: "9069454695",
      name: "List",
      coverUrl: "http://x/p.jpg",
      trackCount: 42,
      source: "qq",
    });
  });
  it("reads legacy cdlist[0] and falls back trackCount to songlist length", () => {
    expect(
      parseQqPlaylistMeta({
        data: {
          cdlist: [{ disstid: 1, dissname: "L", logo: "http://x/l.jpg", songlist: [{}, {}] }],
        },
      }),
    ).toMatchObject({ id: "1", name: "L", coverUrl: "http://x/l.jpg", trackCount: 2 });
  });
  it("returns null without an id / data", () => {
    expect(parseQqPlaylistMeta({ req_0: { data: { dirinfo: {} } } })).toBeNull();
    expect(parseQqPlaylistMeta({})).toBeNull();
  });
});

describe("parseQqPlaylistTracks", () => {
  it("maps the songlist to hits", () => {
    const hits = parseQqPlaylistTracks({
      req_0: {
        data: {
          songlist: [
            { mid: "a", name: "A" },
            { mid: "b", name: "B", album: { mid: "M" } },
          ],
        },
      },
    });
    expect(hits.map((h) => h.externalId)).toEqual(["a", "b"]);
    expect(hits[1].coverUrl).toBe(qqAlbumCover("M"));
  });
  it("reads a songlist nested under dirinfo", () => {
    const hits = parseQqPlaylistTracks({
      data: { dirinfo: { songlist: [{ mid: "z", name: "Z" }] } },
    });
    expect(hits.map((h) => h.externalId)).toEqual(["z"]);
  });
  it("returns [] when empty", () => {
    expect(parseQqPlaylistTracks({})).toEqual([]);
  });
});

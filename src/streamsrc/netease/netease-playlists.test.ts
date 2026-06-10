import { describe, expect, it } from "vitest";
import {
  neteaseSongToHit,
  parseNeteasePlaylistMeta,
  parseNeteasePlaylistTrackIds,
  parseNeteaseSongDetailHits,
  parseNeteaseUserId,
  parseNeteaseUserPlaylists,
} from "./netease-playlists";

describe("parseNeteaseUserId", () => {
  it("reads the logged-in user id from account/profile", () => {
    expect(parseNeteaseUserId({ profile: { userId: 12345 }, account: { id: 12345 } })).toBe(
      "12345",
    );
    expect(parseNeteaseUserId({ account: { id: 678 } })).toBe("678");
    expect(parseNeteaseUserId({ code: 301 })).toBeNull(); // not logged in
  });
});

describe("parseNeteaseUserPlaylists", () => {
  it("maps the playlist[] into stream playlists", () => {
    const out = parseNeteaseUserPlaylists({
      playlist: [
        { id: 1, name: "我喜欢的音乐", coverImgUrl: "https://p/a.jpg", trackCount: 200 },
        { id: 2, name: "歌单二", trackCount: 0 },
      ],
    });
    expect(out).toEqual([
      {
        id: "1",
        name: "我喜欢的音乐",
        coverUrl: "https://p/a.jpg",
        trackCount: 200,
        source: "netease",
      },
      { id: "2", name: "歌单二", coverUrl: undefined, trackCount: 0, source: "netease" },
    ]);
  });

  it("returns [] when there is no playlist array", () => {
    expect(parseNeteaseUserPlaylists({ code: 200 })).toEqual([]);
  });
});

describe("parseNeteasePlaylistMeta", () => {
  it("maps a v6/playlist/detail playlist object to meta", () => {
    expect(
      parseNeteasePlaylistMeta({
        playlist: { id: 99, name: "别人的歌单", coverImgUrl: "https://p/c.jpg", trackCount: 42 },
      }),
    ).toEqual({
      id: "99",
      name: "别人的歌单",
      coverUrl: "https://p/c.jpg",
      trackCount: 42,
      source: "netease",
    });
  });

  it("falls back to trackIds length when trackCount is absent", () => {
    expect(
      parseNeteasePlaylistMeta({
        playlist: { id: 7, name: "x", trackIds: [{ id: 1 }, { id: 2 }] },
      })?.trackCount,
    ).toBe(2);
  });

  it("returns null when there is no playlist (private / not found)", () => {
    expect(parseNeteasePlaylistMeta({ code: 401 })).toBeNull();
  });
});

describe("parseNeteasePlaylistTrackIds", () => {
  it("extracts the full trackIds list (handles large playlists)", () => {
    expect(
      parseNeteasePlaylistTrackIds({
        playlist: { trackIds: [{ id: 111 }, { id: 222 }, { id: 333 }] },
      }),
    ).toEqual(["111", "222", "333"]);
    expect(parseNeteasePlaylistTrackIds({ playlist: {} })).toEqual([]);
  });
});

describe("neteaseSongToHit / parseNeteaseSongDetailHits", () => {
  const song = {
    id: 33894312,
    name: "晴天",
    ar: [{ name: "周杰伦" }],
    al: { name: "叶惠美", picUrl: "https://p1/cover.jpg" },
    dt: 269000,
  };

  it("maps a song record to a hit", () => {
    expect(neteaseSongToHit(song)).toEqual({
      source: "netease",
      externalId: "33894312",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269,
      coverUrl: "https://p1/cover.jpg",
    });
  });

  it("parses song/detail songs[] into hits", () => {
    expect(parseNeteaseSongDetailHits({ songs: [song] })).toHaveLength(1);
    expect(parseNeteaseSongDetailHits({ code: 200 })).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  neteaseSongToHit,
  parseNeteaseDailySongs,
  parseNeteasePlaylistMeta,
  parseNeteasePlaylistTrackIds,
  parseNeteaseRecommendedPlaylists,
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

  it("accepts alternate song/detail and cover field shapes", () => {
    expect(
      parseNeteaseSongDetailHits({
        data: {
          songs: [
            {
              id: 1,
              name: "Alt",
              artists: [{ name: "Artist" }],
              album: { name: "Album", blurPicUrl: "https://p/blur.jpg" },
              duration: 1000,
            },
          ],
        },
      }),
    ).toEqual([
      {
        source: "netease",
        externalId: "1",
        title: "Alt",
        artist: "Artist",
        album: "Album",
        durationSec: 1,
        coverUrl: "https://p/blur.jpg",
      },
    ]);
  });
});

describe("parseNeteaseDailySongs", () => {
  const song = {
    id: 33894312,
    name: "晴天",
    ar: [{ name: "周杰伦" }],
    al: { name: "叶惠美", picUrl: "https://p1/cover.jpg" },
    dt: 269000,
  };

  it("maps data.dailySongs[] into hits", () => {
    expect(parseNeteaseDailySongs({ code: 200, data: { dailySongs: [song] } })).toEqual([
      {
        source: "netease",
        externalId: "33894312",
        title: "晴天",
        artist: "周杰伦",
        album: "叶惠美",
        durationSec: 269,
        coverUrl: "https://p1/cover.jpg",
      },
    ]);
  });

  it("returns [] for not-logged-in / anti-bot / non-object json", () => {
    expect(parseNeteaseDailySongs({ code: 301 })).toEqual([]); // needs login
    expect(parseNeteaseDailySongs({ code: 200, data: {} })).toEqual([]);
    expect(parseNeteaseDailySongs(null)).toEqual([]);
    expect(parseNeteaseDailySongs("<html>nope</html>")).toEqual([]);
  });
});

describe("parseNeteaseRecommendedPlaylists", () => {
  it("maps recommend[] (logged-in daily playlists) via picUrl→coverUrl", () => {
    expect(
      parseNeteaseRecommendedPlaylists({
        code: 200,
        recommend: [{ id: 11, name: "每日30首", picUrl: "https://p/r.jpg", trackCount: 30 }],
      }),
    ).toEqual([
      {
        id: "11",
        name: "每日30首",
        coverUrl: "https://p/r.jpg",
        trackCount: 30,
        source: "netease",
      },
    ]);
  });

  it("maps personalized result[] (anonymous) via picUrl→coverUrl", () => {
    expect(
      parseNeteaseRecommendedPlaylists({
        code: 200,
        result: [
          { id: 22, name: "官方歌单", picUrl: "https://p/p.jpg", trackCount: 50, playCount: 12345 },
        ],
      }),
    ).toEqual([
      {
        id: "22",
        name: "官方歌单",
        coverUrl: "https://p/p.jpg",
        trackCount: 50,
        source: "netease",
      },
    ]);
  });

  it("keeps coverUrl when logged-in recommended resources use playlist-style cover fields", () => {
    const out = parseNeteaseRecommendedPlaylists({
      result: [{ id: 9, name: "x", coverImgUrl: "https://p/wrong.jpg", trackCount: 1 }],
    });
    expect(out[0].coverUrl).toBe("https://p/wrong.jpg");
  });

  it("reads nested image fields from logged-in resource cards", () => {
    const out = parseNeteaseRecommendedPlaylists({
      recommend: [
        {
          id: 10,
          name: "resource",
          resourceExtInfo: { coverUrl: "https://p/resource.jpg" },
          uiElement: { image: { imageUrl: "https://p/ui.jpg" } },
          trackCount: 2,
        },
      ],
    });
    expect(out[0]).toEqual({
      id: "10",
      name: "resource",
      coverUrl: "https://p/resource.jpg",
      trackCount: 2,
      source: "netease",
    });
  });

  it("returns [] for empty / error / non-object json", () => {
    expect(parseNeteaseRecommendedPlaylists({ code: 301 })).toEqual([]);
    expect(parseNeteaseRecommendedPlaylists(null)).toEqual([]);
    expect(parseNeteaseRecommendedPlaylists("not json")).toEqual([]);
  });
});

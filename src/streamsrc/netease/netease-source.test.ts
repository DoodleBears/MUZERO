import { describe, expect, it } from "vitest";
import type { StreamHttp, StreamHttpRequest } from "../http";
import { createNeteaseSource } from "./netease-source";

function makeHttp(routes: Array<[string, unknown]>) {
  const calls: StreamHttpRequest[] = [];
  const http: StreamHttp = async (req) => {
    calls.push(req);
    const hit = routes.find(([frag]) => req.url.includes(frag));
    const body = hit ? hit[1] : { code: -460 };
    return { status: 200, text: async () => JSON.stringify(body), json: async () => body };
  };
  return { http, calls };
}

const SEARCH = {
  code: 200,
  result: {
    songs: [
      {
        id: 33894312,
        name: "晴天",
        ar: [{ name: "周杰伦" }],
        al: { name: "叶惠美", picUrl: "https://p1.music.126.net/cover.jpg" },
        dt: 269000,
      },
    ],
  },
};

const URL_OK = {
  code: 200,
  data: [{ id: 33894312, url: "http://m7.music.126.net/x.flac", type: "flac", size: 4096, fee: 0 }],
};

function deps(routes: Array<[string, unknown]>, cookie?: string) {
  const { http, calls } = makeHttp(routes);
  const source = createNeteaseSource({
    http,
    getCookie: () => cookie,
  });
  return { source, calls };
}

describe("createNeteaseSource", () => {
  it("is a netease provider; isAuthed tracks the MUSIC_U cookie", () => {
    expect(deps([]).source.id).toBe("netease");
    expect(deps([]).source.isAuthed()).toBe(false);
    expect(deps([], "MUSIC_U=abc").source.isAuthed()).toBe(true);
  });

  it("searches via eapi and maps songs to hits", async () => {
    const { source, calls } = deps([["/eapi/cloudsearch/pc", SEARCH]]);
    const hits = await source.search("晴天");
    expect(hits[0]).toMatchObject({
      source: "netease",
      externalId: "33894312",
      title: "晴天",
      artist: "周杰伦",
      album: "叶惠美",
      durationSec: 269,
      coverUrl: "https://p1.music.126.net/cover.jpg",
    });
    // eapi search request carries the encrypted params (no RSA-wrapped key).
    const body = calls.find((c) => c.url.includes("/eapi/cloudsearch/pc"))?.body ?? "";
    expect(body).toContain("params=");
    expect(body).not.toContain("encSecKey=");
  });

  it("resolves via eapi to a playable (https-upgraded) flac stream", async () => {
    const { source, calls } = deps([["/eapi/song/enhance/player/url/v1", URL_OK]]);
    const res = await source.resolve("33894312", { quality: "lossless" });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.stream.mediaUrl).toBe("https://m7.music.126.net/x.flac");
    expect(res.stream.mime).toBe("audio/flac");
    expect(calls.find((c) => c.url.includes("/eapi/"))?.body).toContain("params=");
  });

  it("maps code 301 to requires-login", async () => {
    const { source } = deps([["/eapi/song/enhance/player/url/v1", { code: 301 }]]);
    expect((await source.resolve("1")).kind).toBe("requires-login");
  });

  it("maps a VIP-only song (no url, fee>0) to no-permission", async () => {
    const { source } = deps([
      ["/eapi/song/enhance/player/url/v1", { code: 200, data: [{ url: null, fee: 1 }] }],
    ]);
    const res = await source.resolve("1");
    expect(res).toEqual({ kind: "no-permission", reason: "vip" });
  });

  const DAILY = {
    code: 200,
    data: {
      dailySongs: [
        {
          id: 33894312,
          name: "晴天",
          ar: [{ name: "周杰伦" }],
          al: { name: "叶惠美", picUrl: "https://p1.music.126.net/cover.jpg" },
          dt: 269000,
        },
      ],
    },
  };
  const RESOURCE = {
    code: 200,
    recommend: [{ id: 11, name: "每日推荐歌单", picUrl: "https://p/r.jpg", trackCount: 30 }],
  };
  const PERSONALIZED = {
    code: 200,
    result: [{ id: 22, name: "官方推荐", picUrl: "https://p/p.jpg", trackCount: 50 }],
  };

  it("getDailyRecommendedTracks maps data.dailySongs[] (eapi, no encSecKey)", async () => {
    const { source, calls } = deps([["/eapi/v3/discovery/recommend/songs", DAILY]], "MUSIC_U=abc");
    const hits = await source.getDailyRecommendedTracks?.();
    expect(hits?.[0]).toMatchObject({ externalId: "33894312", title: "晴天", durationSec: 269 });
    const body = calls.find((c) => c.url.includes("recommend/songs"))?.body ?? "";
    expect(body).toContain("params=");
    expect(body).not.toContain("encSecKey=");
  });

  it("getDailyRecommendedTracks passes afresh=true when asked to reroll", async () => {
    const { source, calls } = deps([["/eapi/v3/discovery/recommend/songs", DAILY]], "MUSIC_U=abc");
    await source.getDailyRecommendedTracks?.({ afresh: true });
    // afresh rides inside the encrypted params; assert the request fired (1 call).
    expect(calls.filter((c) => c.url.includes("recommend/songs"))).toHaveLength(1);
  });

  it("getRecommendedPlaylists returns personalized result[] when anonymous (no resource call)", async () => {
    const { source, calls } = deps([["/eapi/personalized/playlist", PERSONALIZED]]);
    const playlists = await source.getRecommendedPlaylists?.();
    expect(playlists).toEqual([
      {
        id: "22",
        name: "官方推荐",
        coverUrl: "https://p/p.jpg",
        trackCount: 50,
        source: "netease",
      },
    ]);
    // Anonymous must not hit the login-gated recommend/resource endpoint.
    expect(calls.some((c) => c.url.includes("recommend/resource"))).toBe(false);
  });

  it("getRecommendedPlaylists merges daily resource ahead of personalized when logged in", async () => {
    const { source } = deps(
      [
        ["/eapi/v1/discovery/recommend/resource", RESOURCE],
        ["/eapi/personalized/playlist", PERSONALIZED],
      ],
      "MUSIC_U=abc",
    );
    const playlists = await source.getRecommendedPlaylists?.();
    expect(playlists?.map((p) => p.id)).toEqual(["11", "22"]);
  });

  it("getRecommendedPlaylists still yields personalized if the resource call fails", async () => {
    // recommend/resource is unmatched → mock returns { code: -460 } (no recommend[]).
    const { source } = deps([["/eapi/personalized/playlist", PERSONALIZED]], "MUSIC_U=abc");
    const playlists = await source.getRecommendedPlaylists?.();
    expect(playlists?.map((p) => p.id)).toEqual(["22"]);
  });

  it("importPlaylist reports progress once per song/detail batch (determinate: processed / total)", async () => {
    // 1200 track ids → SONG_DETAIL_CHUNK(500) → 3 batches: 500, 1000, 1200 of 1200.
    const trackIds = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1 }));
    const { source } = deps([
      ["/eapi/v6/playlist/detail", { playlist: { trackIds } }],
      ["/eapi/v3/song/detail", { songs: [] }],
    ]);
    const progress: Array<[number, number | undefined]> = [];
    await source.importPlaylist?.("100", {
      onProgress: (done, total) => progress.push([done, total]),
    });
    // The batched fetch — the real time sink — drives a live, determinate bar (total known upfront).
    expect(progress).toEqual([
      [500, 1200],
      [1000, 1200],
      [1200, 1200],
    ]);
  });
});

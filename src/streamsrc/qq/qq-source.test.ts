import { describe, expect, it } from "vitest";
import type { StreamHttp, StreamHttpResponse } from "../http";
import { qqGtk } from "./qq-sign";
import { createQqSource } from "./qq-source";

function res(body: unknown): StreamHttpResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

describe("createQqSource", () => {
  it("is a guest provider (no login required)", () => {
    const src = createQqSource({ http: async () => res({}) });
    expect(src.id).toBe("qq");
    expect(src.requiresLogin).toBe(false);
    expect(src.isAuthed()).toBe(false);
  });

  it("isAuthed once a cookie is present", () => {
    const src = createQqSource({ http: async () => res({}), getCookie: () => "qqmusic_key=W_X_1" });
    expect(src.isAuthed()).toBe(true);
  });

  it("signs with g_tk=hash33(musickey) when logged in (not guest 5381)", async () => {
    const musickey = "W_X_abc";
    const expected = qqGtk(musickey);
    expect(expected).not.toBe(5381);
    const http: StreamHttp = async (req) => {
      expect(req.url).toContain(`g_tk=${expected}`);
      expect(req.url).not.toContain("g_tk=5381");
      expect(req.headers?.Cookie).toContain(`qqmusic_key=${musickey}`);
      return res({ music_search: { data: { body: { song: { list: [] } } } } });
    };
    await createQqSource({
      http,
      getCookie: () => `qqmusic_uin=1; qqmusic_key=${musickey}`,
    }).search("q");
  });

  it("search posts the modern musicu SearchCgiService query and maps hits (guest g_tk)", async () => {
    const http: StreamHttp = async (req) => {
      expect(req.url).toContain("musicu.fcg");
      expect(req.url).toContain("g_tk=5381"); // guest g_tk
      // The keyword rides inside the posted `data` JSON, not the URL query.
      const data = JSON.parse(new URL(req.url).searchParams.get("data") ?? "{}") as Record<
        string,
        { module?: string; method?: string; param?: { query?: string } }
      >;
      const search = data.music_search ?? Object.values(data).find((v) => v?.method);
      expect(search?.module).toBe("music.search.SearchCgiService");
      expect(search?.param?.query).toBe("hello");
      return res({
        music_search: {
          data: {
            body: {
              song: {
                list: [
                  {
                    mid: "1",
                    name: "S",
                    singer: [{ name: "A" }],
                    album: { mid: "M" },
                    interval: 100,
                  },
                ],
              },
            },
          },
        },
      });
    };
    const hits = await createQqSource({ http }).search("hello");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "qq", externalId: "1", title: "S", artist: "A" });
  });

  it("search tolerates a callback(...) JSONP wrapper", async () => {
    const http: StreamHttp = async () =>
      res(
        `callback(${JSON.stringify({ music_search: { data: { body: { song: { list: [{ mid: "9", name: "z" }] } } } } })})`,
      );
    const hits = await createQqSource({ http }).search("q");
    expect(hits[0]?.externalId).toBe("9");
  });

  it("resolve returns the best plaintext stream with a non-empty purl", async () => {
    const http: StreamHttp = async (req) => {
      if (req.url.includes("musicu.fcg")) {
        // flac purl empty (encrypted-only), 320 has a purl → pick 320
        return res({
          req_0: {
            data: {
              sip: ["https://dl.stream.qqmusic.qq.com/"],
              midurlinfo: [
                { filename: "F000XX.flac", purl: "" },
                { filename: "M800XX.mp3", purl: "M800XX.mp3?vkey=K" },
                { filename: "C400XX.m4a", purl: "" },
                { filename: "M500XX.mp3", purl: "" },
              ],
            },
          },
        });
      }
      return res({});
    };
    const out = await createQqSource({ http }).resolve("X");
    expect(out.kind).toBe("ok");
    if (out.kind === "ok") {
      expect(out.stream.mediaUrl).toBe("https://dl.stream.qqmusic.qq.com/M800XX.mp3?vkey=K");
      expect(out.stream.quality).toBe("320");
      expect(out.stream.mime).toBe("audio/mpeg");
      expect(out.stream.headers?.Referer).toBe("https://y.qq.com");
    }
  });

  it("resolve sends the logged-in uin + authst(musickey) in the GetVkey body", async () => {
    const musickey = "Q_X_key";
    let sentData: {
      comm?: { uin?: string; authst?: string };
      req_0?: { param?: { uin?: string } };
    } = {};
    const http: StreamHttp = async (req) => {
      sentData = JSON.parse(new URL(req.url).searchParams.get("data") ?? "{}");
      return res({
        req_0: {
          data: {
            sip: ["https://dl.stream.qqmusic.qq.com/"],
            midurlinfo: [{ filename: "M800XX.mp3", purl: "M800XX.mp3?vkey=K" }],
          },
        },
      });
    };
    await createQqSource({
      http,
      getCookie: () => `qqmusic_uin=999; qqmusic_key=${musickey}`,
    }).resolve("XX", { quality: "320" });
    expect(sentData.comm?.uin).toBe("999");
    expect(sentData.comm?.authst).toBe(musickey);
    expect(sentData.req_0?.param?.uin).toBe("999");
  });

  it("resolve reports no-permission when every plaintext purl is empty", async () => {
    const http: StreamHttp = async () =>
      res({
        req_0: {
          data: {
            sip: [],
            midurlinfo: [
              { filename: "F000XX.flac", purl: "" },
              { filename: "M800XX.mp3", purl: "" },
              { filename: "C400XX.m4a", purl: "" },
              { filename: "M500XX.mp3", purl: "" },
            ],
          },
        },
      });
    const out = await createQqSource({ http }).resolve("X");
    expect(out).toEqual({ kind: "no-permission", reason: "vip-or-encrypted" });
  });

  it("getTracksByIds resolves song mids via get_song_detail_yqq", async () => {
    const http: StreamHttp = async (req) => {
      expect(req.url).toContain("musicu.fcg");
      return res({
        songinfo: {
          data: { track_info: { mid: "m1", name: "T", singer: [{ name: "S" }], interval: 200 } },
        },
      });
    };
    const hits = await createQqSource({ http }).getTracksByIds?.(["m1"]);
    expect(hits).toHaveLength(1);
    expect(hits?.[0]).toMatchObject({
      source: "qq",
      externalId: "m1",
      title: "T",
      artist: "S",
      durationSec: 200,
    });
  });

  it("getPlaylistMeta + importPlaylist read aiDissInfo", async () => {
    const diss = {
      req_0: {
        data: {
          dirinfo: { id: 7, title: "P", songnum: 2 },
          songlist: [
            { mid: "a", name: "A" },
            { mid: "b", name: "B" },
          ],
        },
      },
    };
    const src = createQqSource({ http: async () => res(diss) });
    expect(await src.getPlaylistMeta?.("7")).toMatchObject({
      id: "7",
      name: "P",
      trackCount: 2,
      source: "qq",
    });
    const tracks = await src.importPlaylist?.("7");
    expect(tracks?.map((h) => h.externalId)).toEqual(["a", "b"]);
  });

  it("getUserPlaylists returns [] when not logged in (no uin)", async () => {
    const src = createQqSource({ http: async () => res({}) });
    expect(await src.getUserPlaylists?.()).toEqual([]);
  });

  it("getUserPlaylists fetches fcg_user_created_diss for the logged-in uin", async () => {
    const musickey = "W_X_k";
    const http: StreamHttp = async (req) => {
      expect(req.url).toContain("fcg_user_created_diss");
      expect(req.url).toContain("hostuin=12345");
      expect(req.url).toContain(`g_tk=${qqGtk(musickey)}`);
      expect(req.headers?.Cookie).toContain(`qqmusic_key=${musickey}`);
      return res({
        data: {
          disslist: [
            { tid: 201, diss_name: "我喜欢", diss_cover: "http://x/f.jpg", song_cnt: 5 },
            { tid: 88, diss_name: "P2", song_cnt: 9 },
          ],
        },
      });
    };
    const src = createQqSource({
      http,
      getCookie: () => `qqmusic_uin=12345; qqmusic_key=${musickey}`,
    });
    const lists = await src.getUserPlaylists?.();
    expect(lists?.map((p) => p.id)).toEqual(["201", "88"]);
    expect(lists?.[0]).toMatchObject({ name: "我喜欢", trackCount: 5, source: "qq" });
  });
});

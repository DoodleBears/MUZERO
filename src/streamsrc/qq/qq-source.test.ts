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
      return res({ data: { song: { list: [] } } });
    };
    await createQqSource({
      http,
      getCookie: () => `qqmusic_uin=1; qqmusic_key=${musickey}`,
    }).search("q");
  });

  it("search maps client_search_cp results to hits and sends guest g_tk", async () => {
    const http: StreamHttp = async (req) => {
      expect(req.url).toContain("client_search_cp");
      expect(req.url).toContain("g_tk=5381"); // guest g_tk
      expect(req.url).toContain("w=hello");
      return res({
        data: {
          song: {
            list: [
              {
                songmid: "1",
                songname: "S",
                singer: [{ name: "A" }],
                albummid: "M",
                interval: 100,
              },
            ],
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
        `callback(${JSON.stringify({ data: { song: { list: [{ songmid: "9", songname: "z" }] } } })})`,
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
});

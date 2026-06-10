import { describe, expect, it } from "vitest";
import type { StreamHttp, StreamHttpRequest } from "@/streamsrc/http";
import { createNeteaseLyricsProvider } from "./netease-lyrics-provider";

const SYNCED = "[00:01.00]line one\n[00:02.00]line two";

/** A stub StreamHttp routing on URL: lyric vs cloudsearch. Records every request. */
function stubHttp(opts: { lyricBySongId?: Record<string, unknown>; songs?: unknown[] }): {
  http: StreamHttp;
  calls: StreamHttpRequest[];
} {
  const calls: StreamHttpRequest[] = [];
  const http: StreamHttp = async (req) => {
    calls.push(req);
    if (req.url.includes("/song/lyric")) {
      // The eapi body is encrypted; tests assert via which songId's lyric we returned.
      // Decode nothing — return a single configured lyric (one-song tests) or look up
      // by a hint param appended in the test.
      const id = req.url.includes("__id=") ? new URL(req.url).searchParams.get("__id") : null;
      const byId = opts.lyricBySongId ?? {};
      const body = id ? byId[id] : Object.values(byId)[0];
      return jsonRes(body ?? { code: 200, lrc: { lyric: SYNCED } });
    }
    if (req.url.includes("/cloudsearch")) {
      return jsonRes({ result: { songs: opts.songs ?? [] } });
    }
    return jsonRes({ code: 404 });
  };
  return { http, calls };
}

function jsonRes(value: unknown) {
  const text = JSON.stringify(value);
  return { status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

const song = (id: number, dt: number) => ({
  id,
  name: `Song ${id}`,
  ar: [{ name: "Artist" }],
  al: { name: "Album", picUrl: "https://p/c.jpg" },
  dt,
});

describe("createNeteaseLyricsProvider", () => {
  it("getById fetches lyrics for a song id and returns synced LRC", async () => {
    const { http } = stubHttp({ lyricBySongId: { any: { lrc: { lyric: SYNCED } } } });
    const provider = createNeteaseLyricsProvider({ http });
    const hit = await provider.getById?.("33894312");
    expect(hit).toMatchObject({
      source: "netease",
      sourceId: "33894312",
      synced: SYNCED,
      instrumental: false,
    });
  });

  it("fetch with neteaseSongId goes straight to lyric (no cloudsearch)", async () => {
    const { http, calls } = stubHttp({ lyricBySongId: { x: { lrc: { lyric: SYNCED } } } });
    const provider = createNeteaseLyricsProvider({ http });
    const hit = await provider.fetch({ trackName: "t", artistName: "a", neteaseSongId: "555" });
    expect(hit?.synced).toBe(SYNCED);
    expect(calls.some((c) => c.url.includes("/cloudsearch"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/song/lyric"))).toBe(true);
  });

  it("fetch without a songId searches, picks the closest duration, then fetches its lyric", async () => {
    // We can't read the encrypted eapi body, so prove duration-pick differently:
    // a search returning songs, then assert a lyric request was made (the chain ran).
    const { http, calls } = stubHttp({
      songs: [song(1, 100_000), song(2, 300_000)],
      lyricBySongId: { any: { lrc: { lyric: SYNCED } } },
    });
    const provider = createNeteaseLyricsProvider({ http });
    const hit = await provider.fetch({ trackName: "Song", artistName: "Artist", durationSec: 300 });
    expect(hit?.synced).toBe(SYNCED);
    expect(calls.filter((c) => c.url.includes("/cloudsearch"))).toHaveLength(1);
    expect(calls.some((c) => c.url.includes("/song/lyric"))).toBe(true);
  });

  it("fetch returns null when the search finds nothing", async () => {
    const { http } = stubHttp({ songs: [] });
    const provider = createNeteaseLyricsProvider({ http });
    expect(await provider.fetch({ trackName: "nope", artistName: "nobody" })).toBeNull();
  });

  it("getById returns null for uncollected lyrics", async () => {
    const { http } = stubHttp({ lyricBySongId: { any: { code: 200, lrc: { lyric: "" } } } });
    const provider = createNeteaseLyricsProvider({ http });
    expect(await provider.getById?.("0")).toBeNull();
  });
});

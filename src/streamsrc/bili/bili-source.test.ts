import { describe, expect, it } from "vitest";
import type { StreamHttp, StreamHttpRequest } from "../http";
import { createBiliSource } from "./bili-source";

/** A stub StreamHttp that routes by URL substring and records calls. */
function makeHttp(routes: Array<[string, unknown]>) {
  const calls: StreamHttpRequest[] = [];
  const http: StreamHttp = async (req) => {
    calls.push(req);
    const hit = routes.find(([frag]) => req.url.includes(frag));
    const body = hit ? hit[1] : { code: -404 };
    return {
      status: 200,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  };
  return { http, calls };
}

const NAV = {
  code: 0,
  data: {
    wbi_img: {
      img_url: "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
      sub_url: "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
    },
  },
};

const SEARCH = {
  code: 0,
  data: {
    result: [
      {
        bvid: "BV1xx411c7mD",
        title: 'Best <em class="keyword">song</em> ever',
        author: "UP主A",
        duration: "4:05",
        pic: "//i0.hdslb.com/cover.jpg",
      },
    ],
  },
};

const VIEW = { code: 0, data: { bvid: "BV1xx411c7mD", cid: 998877, pages: [{ cid: 998877 }] } };

const PLAYURL = {
  code: 0,
  data: {
    dash: {
      audio: [
        {
          id: 30280,
          baseUrl: "https://upos-sz-mirror08c.bilivideo.com/a192.m4s",
          backupUrl: [],
          bandwidth: 192000,
          mimeType: "audio/mp4",
          codecs: "mp4a.40.2",
        },
      ],
    },
  },
};

function deps(routes: Array<[string, unknown]>, cookie?: string) {
  const { http, calls } = makeHttp(routes);
  const source = createBiliSource({ http, now: () => 1_700_000_000_000, getCookie: () => cookie });
  return { source, calls };
}

describe("createBiliSource", () => {
  it("exposes a non-login-required bili provider; isAuthed tracks the cookie", () => {
    const { source } = deps([], undefined);
    expect(source.id).toBe("bili");
    expect(source.requiresLogin).toBe(false);
    expect(source.isAuthed()).toBe(false);
    expect(deps([], "SESSDATA=x").source.isAuthed()).toBe(true);
  });

  it("searches: signs with WBI, strips <em>, parses duration, externalId = bvid", async () => {
    const { source, calls } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/search/type", SEARCH],
    ]);
    const hits = await source.search("song");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "bili",
      externalId: "BV1xx411c7mD",
      title: "Best song ever",
      artist: "UP主A",
      durationSec: 245,
      coverUrl: "https://i0.hdslb.com/cover.jpg",
    });
    // The signed search request must carry w_rid + wts.
    const searchCall = calls.find((c) => c.url.includes("/wbi/search/type"));
    expect(searchCall?.url).toMatch(/w_rid=/);
    expect(searchCall?.url).toMatch(/wts=/);
  });

  it("resolves a bvid: view → cid → playurl, returns a Referer-bearing stream", async () => {
    const { source, calls } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/view", VIEW],
      ["/player/wbi/playurl", PLAYURL],
    ]);
    const res = await source.resolve("BV1xx411c7mD", { quality: "high" });
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.stream.mediaUrl).toContain("upos");
    expect(res.stream.headers?.Referer).toBe("https://www.bilibili.com");
    expect(res.stream.mime).toBe("audio/mp4");
    expect(calls.some((c) => c.url.includes("/wbi/view"))).toBe(true);
  });

  it("skips the view call when the externalId already carries a cid (bvid#cid)", async () => {
    const { source, calls } = deps([
      ["/x/web-interface/nav", NAV],
      ["/player/wbi/playurl", PLAYURL],
    ]);
    const res = await source.resolve("BV1xx411c7mD#998877");
    expect(res.kind).toBe("ok");
    expect(calls.some((c) => c.url.includes("/wbi/view"))).toBe(false);
  });

  it("caches the WBI key pair across calls (nav fetched once)", async () => {
    const { source, calls } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/search/type", SEARCH],
    ]);
    await source.search("a");
    await source.search("b");
    expect(calls.filter((c) => c.url.includes("/x/web-interface/nav"))).toHaveLength(1);
  });

  it("returns an error result when playurl has no audio", async () => {
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/view", VIEW],
      ["/player/wbi/playurl", { code: 0, data: { dash: { audio: [] } } }],
    ]);
    const res = await source.resolve("BV1xx411c7mD");
    expect(res.kind).toBe("error");
  });
});

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

/** A playurl body with DASH video (multi-codec 1080p) + an audio track to ignore. */
const PLAYURL_VIDEO = {
  code: 0,
  data: {
    dash: {
      video: [
        {
          id: 64,
          baseUrl: "https://upos-sz-mirror08c.bilivideo.com/v720-avc.m4s?deadline=1700003600",
          bandwidth: 1200000,
          codecs: "avc1.640020",
          width: 1280,
          height: 720,
          frameRate: "30",
        },
        {
          id: 80,
          baseUrl: "https://upos-sz-mirror08c.bilivideo.com/v1080-avc.m4s?deadline=1700003600",
          bandwidth: 2400000,
          codecs: "avc1.640032",
          width: 1920,
          height: 1080,
          frameRate: "30",
        },
        {
          id: 80,
          baseUrl: "https://upos-sz-mirror08c.bilivideo.com/v1080-av1.m4s",
          bandwidth: 1500000,
          codecs: "av01.0.08M.08",
          width: 1920,
          height: 1080,
          frameRate: "30",
        },
      ],
      audio: [{ id: 30280, baseUrl: "https://upos/a.m4s", bandwidth: 192000, codecs: "mp4a.40.2" }],
    },
  },
};

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

describe("createBiliSource.resolveVideo / listVideoQualities", () => {
  it("resolves a video track via view → cid → playurl(fnval=4048), AVC-first by default", async () => {
    const { source, calls } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/view", VIEW],
      ["/player/wbi/playurl", PLAYURL_VIDEO],
    ]);
    const res = await source.resolveVideo?.("BV1xx411c7mD");
    expect(res?.kind).toBe("ok");
    if (res?.kind !== "ok") return;
    expect(res.video.height).toBe(1080);
    expect(res.video.codec).toBe("avc"); // default codec preference favors AVC for mp4 copy
    expect(res.video.mime).toBe("video/mp4");
    expect(res.video.headers?.Referer).toBe("https://www.bilibili.com");
    expect(res.video.expiresAt).toBe(1700003600 * 1000); // from CDN deadline=
    // The video resolve must use the richer DASH mask, NOT the audio fnval=16.
    const playurlCall = calls.find((c) => c.url.includes("/player/wbi/playurl"));
    expect(playurlCall?.url).toMatch(/fnval=4048/);
  });

  it("honors a quality cap (720 does not return 1080)", async () => {
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/player/wbi/playurl", PLAYURL_VIDEO],
    ]);
    const res = await source.resolveVideo?.("BV1xx411c7mD#998877", { quality: "720" });
    expect(res?.kind === "ok" && res.video.height).toBe(720);
  });

  it("lists one quality option per resolution, highest first, AVC-first representative", async () => {
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/player/wbi/playurl", PLAYURL_VIDEO],
    ]);
    const opts = await source.listVideoQualities?.("BV1xx411c7mD#998877");
    expect(opts?.map((o) => o.height)).toEqual([1080, 720]);
    expect(opts?.[0]).toMatchObject({ key: "1080", label: "1080P", codec: "avc" });
  });

  it("returns an error result when playurl has no video", async () => {
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/player/wbi/playurl", { code: 0, data: { dash: { video: [] } } }],
    ]);
    const res = await source.resolveVideo?.("BV1xx411c7mD#998877");
    expect(res?.kind).toBe("error");
  });

  it("listParts maps multi-P pages to parts (bvid#cid), and [] for single-part", async () => {
    const VIEW_MULTI = {
      code: 0,
      data: {
        bvid: "BVmulti",
        title: "合集",
        pages: [
          { cid: 111, page: 1, part: "第一回", duration: 100 },
          { cid: 222, page: 2, part: "第二回", duration: 200 },
        ],
      },
    };
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/view", VIEW_MULTI],
    ]);
    const parts = (await source.listParts?.("BVmulti")) ?? [];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      externalId: "BVmulti#111",
      index: 1,
      title: "第一回",
      durationSec: 100,
    });
    expect(parts[1].externalId).toBe("BVmulti#222");

    const single = deps([
      ["/x/web-interface/nav", NAV],
      [
        "/wbi/view",
        { code: 0, data: { bvid: "BVsingle", pages: [{ cid: 9, page: 1, part: "" }] } },
      ],
    ]);
    expect((await single.source.listParts?.("BVsingle")) ?? []).toEqual([]);
  });

  it("getTracksByIds resolves official cover (pic) + title + author via the view API", async () => {
    const VIEW_FULL = {
      code: 0,
      data: {
        bvid: "BV1X163BQEo8",
        title: "官方标题",
        pic: "//i2.hdslb.com/bfs/archive/cover.jpg",
        duration: 245,
        owner: { name: "UP主B" },
        cid: 12345,
      },
    };
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/wbi/view", VIEW_FULL],
    ]);
    const hits = (await source.getTracksByIds?.(["BV1X163BQEo8#12345"])) ?? [];
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      source: "bili",
      externalId: "BV1X163BQEo8",
      title: "官方标题",
      artist: "UP主B",
      durationSec: 245,
      coverUrl: "https://i2.hdslb.com/bfs/archive/cover.jpg",
    });
  });

  it("getUserPlaylists lists the logged-in user's fav folders (needs login)", async () => {
    const NAV_MID = { code: 0, data: { mid: 12345, wbi_img: NAV.data.wbi_img } };
    const FOLDERS = {
      code: 0,
      data: { list: [{ id: 100, title: "收藏A", media_count: 3, cover: "//i0.hdslb.com/f.jpg" }] },
    };
    const { source } = deps(
      [
        ["/x/web-interface/nav", NAV_MID],
        ["/fav/folder/created", FOLDERS],
      ],
      "SESSDATA=abc",
    );
    const pls = (await source.getUserPlaylists?.()) ?? [];
    expect(pls).toHaveLength(1);
    expect(pls[0]).toMatchObject({ source: "bili", id: "100", name: "收藏A", trackCount: 3 });

    // Anonymous → no fav folders.
    const { source: anon } = deps([["/x/web-interface/nav", NAV_MID]], undefined);
    expect((await anon.getUserPlaylists?.()) ?? []).toEqual([]);
  });

  it("getPlaylistMeta reads folder info from a resource-list page", async () => {
    const RES = {
      code: 0,
      data: { info: { id: 100, title: "收藏A", media_count: 9 }, medias: [], has_more: false },
    };
    const { source } = deps([
      ["/x/web-interface/nav", NAV],
      ["/fav/resource", RES],
    ]);
    expect(await source.getPlaylistMeta?.("100")).toMatchObject({
      source: "bili",
      id: "100",
      name: "收藏A",
      trackCount: 9,
    });
  });

  it("importPlaylist paginates the resource list until has_more is false", async () => {
    let pages = 0;
    const http: StreamHttp = async (req) => {
      let body: unknown = { code: -404 };
      if (req.url.includes("/x/web-interface/nav")) body = NAV;
      else if (req.url.includes("/fav/resource")) {
        pages += 1;
        const pn = new URL(req.url).searchParams.get("pn");
        body =
          pn === "1"
            ? { code: 0, data: { medias: [{ bvid: "BV1", title: "a" }], has_more: true } }
            : { code: 0, data: { medias: [{ bvid: "BV2", title: "b" }], has_more: false } };
      }
      return { status: 200, text: async () => JSON.stringify(body), json: async () => body };
    };
    const source = createBiliSource({ http, now: () => 1_700_000_000_000 });
    const hits = (await source.importPlaylist?.("100")) ?? [];
    expect(hits.map((h) => h.externalId)).toEqual(["BV1", "BV2"]);
    expect(pages).toBe(2);
  });
});

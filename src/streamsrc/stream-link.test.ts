import { describe, expect, it } from "vitest";
import type { StreamHttp, StreamHttpResponse } from "./http";
import {
  expandStreamLink,
  parseBareStreamId,
  parseStreamLink,
  qqShortLinkUrl,
  scrapeQqLink,
} from "./stream-link";

describe("parseStreamLink — Bilibili / YouTube", () => {
  it("parses a bilibili video link to its BV id", () => {
    expect(parseStreamLink("https://www.bilibili.com/video/BV1HLz9BJEgi")).toEqual({
      source: "bili",
      kind: "song",
      id: "BV1HLz9BJEgi",
    });
  });

  it("ignores trailing slash + tracking query params on a bilibili link", () => {
    expect(
      parseStreamLink(
        "https://www.bilibili.com/video/BV1HLz9BJEgi/?spm_id_from=333.788.recommend_more_video.0&trackid=web_related_0&vd_source=d45f427294bdd32326714d1ff2f39cae",
      ),
    ).toEqual({ source: "bili", kind: "song", id: "BV1HLz9BJEgi" });
  });

  it("parses a youtube shorts link", () => {
    expect(parseStreamLink("https://www.youtube.com/shorts/0EbmNplrNqE")).toEqual({
      source: "youtube",
      kind: "song",
      id: "0EbmNplrNqE",
    });
  });

  it("parses watch?v=, youtu.be, and playlist links", () => {
    expect(parseStreamLink("https://www.youtube.com/watch?v=EvuXIk2Bh78&t=10s")).toEqual({
      source: "youtube",
      kind: "song",
      id: "EvuXIk2Bh78",
    });
    expect(parseStreamLink("https://youtu.be/EvuXIk2Bh78")).toEqual({
      source: "youtube",
      kind: "song",
      id: "EvuXIk2Bh78",
    });
    expect(parseStreamLink("https://www.youtube.com/playlist?list=PL12345")).toEqual({
      source: "youtube",
      kind: "playlist",
      id: "PL12345",
    });
  });
});

describe("parseBareStreamId", () => {
  it("recognizes a bare BV number", () => {
    expect(parseBareStreamId("BV1HLz9BJEgi")).toEqual({
      source: "bili",
      kind: "song",
      id: "BV1HLz9BJEgi",
    });
    expect(parseBareStreamId("  BV1HLz9BJEgi  ")).toEqual({
      source: "bili",
      kind: "song",
      id: "BV1HLz9BJEgi",
    });
    expect(parseBareStreamId("av170001")).toEqual({ source: "bili", kind: "song", id: "av170001" });
  });

  it("recognizes a bare 11-char YouTube id (BV is 12 chars → no collision)", () => {
    expect(parseBareStreamId("0EbmNplrNqE")).toEqual({
      source: "youtube",
      kind: "song",
      id: "0EbmNplrNqE",
    });
    expect(parseBareStreamId("EvuXIk2Bh78")).toEqual({
      source: "youtube",
      kind: "song",
      id: "EvuXIk2Bh78",
    });
  });

  it("returns null for ordinary text queries", () => {
    expect(parseBareStreamId("周杰伦 七里香")).toBeNull();
    expect(parseBareStreamId("hello")).toBeNull();
    expect(parseBareStreamId("a song title here")).toBeNull();
  });
});

describe("parseStreamLink", () => {
  it("parses a plain netease song link", () => {
    expect(parseStreamLink("https://music.163.com/song?id=2664538545")).toEqual({
      source: "netease",
      kind: "song",
      id: "2664538545",
    });
  });

  it("parses a hash-routed netease song link (#/song?id=)", () => {
    expect(parseStreamLink("https://music.163.com/#/song?id=123")).toEqual({
      source: "netease",
      kind: "song",
      id: "123",
    });
  });

  it("parses a mobile share song link with extra query params", () => {
    expect(parseStreamLink("https://y.music.163.com/m/song?id=123&userid=9")).toEqual({
      source: "netease",
      kind: "song",
      id: "123",
    });
  });

  it("parses the /song/{id}/ path form used in share text", () => {
    expect(parseStreamLink("https://y.music.163.com/m/song/2664538545/?userid=9")).toEqual({
      source: "netease",
      kind: "song",
      id: "2664538545",
    });
  });

  it("parses a netease playlist link", () => {
    expect(parseStreamLink("https://music.163.com/playlist?id=456")).toEqual({
      source: "netease",
      kind: "playlist",
      id: "456",
    });
  });

  it("parses a hash-routed playlist link", () => {
    expect(parseStreamLink("https://music.163.com/#/playlist?id=456")).toEqual({
      source: "netease",
      kind: "playlist",
      id: "456",
    });
  });

  it("extracts the url from surrounding share text", () => {
    const text =
      "分享歌单《My List》: https://y.music.163.com/m/playlist?id=456&userid=9 (来自@网易云音乐)";
    expect(parseStreamLink(text)).toEqual({ source: "netease", kind: "playlist", id: "456" });
  });

  it("ignores non-song/playlist netease links (e.g. artist)", () => {
    expect(parseStreamLink("https://music.163.com/artist?id=789")).toBeNull();
  });

  it("ignores unrelated urls and non-urls", () => {
    expect(parseStreamLink("https://example.com/playlist?id=1")).toBeNull();
    expect(parseStreamLink("just some text")).toBeNull();
    expect(parseStreamLink("")).toBeNull();
  });

  it("parses a qq songDetail link (alphanumeric mid)", () => {
    expect(parseStreamLink("https://y.qq.com/n/ryqq/songDetail/003OUlho2HcRHC")).toEqual({
      source: "qq",
      kind: "song",
      id: "003OUlho2HcRHC",
    });
  });

  it("parses an older /n/yqq/song/<mid>.html link", () => {
    expect(parseStreamLink("https://y.qq.com/n/yqq/song/003OUlho2HcRHC.html")).toEqual({
      source: "qq",
      kind: "song",
      id: "003OUlho2HcRHC",
    });
  });

  it("parses a qq playlist link (numeric disstid)", () => {
    expect(parseStreamLink("https://y.qq.com/n/ryqq/playlist/9069454695")).toEqual({
      source: "qq",
      kind: "playlist",
      id: "9069454695",
    });
  });

  it("parses a qq mobile taoge share link from surrounding text", () => {
    expect(
      parseStreamLink(
        "听歌单 https://i.y.qq.com/n2/m/share/details/taoge.html?id=9069454695&uin=1",
      ),
    ).toEqual({ source: "qq", kind: "playlist", id: "9069454695" });
  });

  it("ignores qq album / non song-playlist links", () => {
    expect(parseStreamLink("https://y.qq.com/n/ryqq/albumDetail/000abc")).toBeNull();
  });

  it("does not resolve a qq short link directly (needs expansion)", () => {
    expect(parseStreamLink("https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS")).toBeNull();
  });
});

describe("qqShortLinkUrl", () => {
  it("detects the c.y.qq.com / c6.y.qq.com base/fcgi-bin/u shortener", () => {
    expect(qqShortLinkUrl("https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS")).toBe(
      "https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS",
    );
    expect(qqShortLinkUrl("https://c.y.qq.com/base/fcgi-bin/u?__=abc")).toBe(
      "https://c.y.qq.com/base/fcgi-bin/u?__=abc",
    );
  });
  it("extracts the short link from surrounding share text", () => {
    expect(
      qqShortLinkUrl("分享歌单：https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS （来自QQ音乐）"),
    ).toBe("https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS");
  });
  it("returns null for a full (already-parseable) link or non-qq url", () => {
    expect(qqShortLinkUrl("https://y.qq.com/n/ryqq/playlist/9069454695")).toBeNull();
    expect(qqShortLinkUrl("https://example.com/base/fcgi-bin/u?__=x")).toBeNull();
    expect(qqShortLinkUrl("just text")).toBeNull();
  });
});

describe("scrapeQqLink", () => {
  it("finds an embedded qq playlist url in the page", () => {
    const html = `<meta http-equiv="refresh" content="0;url=https://y.qq.com/n/ryqq/playlist/9069454695">`;
    expect(scrapeQqLink(html)).toEqual({ source: "qq", kind: "playlist", id: "9069454695" });
  });
  it("un-escapes a JS-escaped url (https:\\/\\/…)", () => {
    const html = `var u="https:\\/\\/i.y.qq.com\\/n2\\/m\\/share\\/details\\/taoge.html?id=9069454695";`;
    expect(scrapeQqLink(html)).toEqual({ source: "qq", kind: "playlist", id: "9069454695" });
  });
  it("falls back to a bare disstid in json", () => {
    expect(scrapeQqLink('{"foo":1,"disstid":9069454695,"bar":2}')).toEqual({
      source: "qq",
      kind: "playlist",
      id: "9069454695",
    });
  });
  it("returns null when no qq link / disstid is present", () => {
    expect(scrapeQqLink("<html><body>nothing here</body></html>")).toBeNull();
  });
});

describe("expandStreamLink", () => {
  function bodyRes(body: string): StreamHttpResponse {
    return { status: 200, text: async () => body, json: async () => ({}) };
  }

  it("fetches a qq short link and scrapes the playlist ref from the page", async () => {
    const http: StreamHttp = async (req) => {
      expect(req.url).toBe("https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS");
      return bodyRes(
        `<script>location.href="https://y.qq.com/n/ryqq/playlist/9069454695";</script>`,
      );
    };
    expect(await expandStreamLink("https://c6.y.qq.com/base/fcgi-bin/u?__=PxaHiqS", http)).toEqual({
      source: "qq",
      kind: "playlist",
      id: "9069454695",
    });
  });

  it("returns null when the link isn't an expandable short link", async () => {
    const http: StreamHttp = async () => bodyRes("https://whatever");
    expect(await expandStreamLink("https://y.qq.com/n/ryqq/playlist/1", http)).toBeNull();
  });

  it("returns null when the page has no parseable qq link", async () => {
    const http: StreamHttp = async () => bodyRes("<html>loading…</html>");
    expect(await expandStreamLink("https://c6.y.qq.com/base/fcgi-bin/u?__=x", http)).toBeNull();
  });
});

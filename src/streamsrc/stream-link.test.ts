import { describe, expect, it } from "vitest";
import { parseStreamLink } from "./stream-link";

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
});

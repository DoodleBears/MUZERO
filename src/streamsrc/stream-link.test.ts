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
});

import { describe, expect, it } from "vitest";
import {
  assembleCookieHeader,
  cookieStringHasAuth,
  hasAuthCookie,
  STREAM_LOGIN_CONFIGS,
} from "./login";

describe("STREAM_LOGIN_CONFIGS", () => {
  it("wires netease (MUSIC_U) and bili (SESSDATA) with login URLs + cookie domains", () => {
    expect(STREAM_LOGIN_CONFIGS.netease).toMatchObject({
      authCookie: "MUSIC_U",
      cookieUrls: ["https://music.163.com"],
    });
    expect(STREAM_LOGIN_CONFIGS.netease?.loginUrl).toContain("music.163.com");
    expect(STREAM_LOGIN_CONFIGS.bili).toMatchObject({ authCookie: "SESSDATA" });
    expect(STREAM_LOGIN_CONFIGS.bili?.cookieUrls).toContain("https://www.bilibili.com");
    // YouTube uses OAuth, not a cookie login — intentionally absent for now.
    expect(STREAM_LOGIN_CONFIGS.youtube).toBeUndefined();
  });
});

describe("assembleCookieHeader", () => {
  it("joins name=value pairs with '; '", () => {
    expect(
      assembleCookieHeader([
        { name: "SESSDATA", value: "abc" },
        { name: "bili_jct", value: "xyz" },
      ]),
    ).toBe("SESSDATA=abc; bili_jct=xyz");
  });

  it("drops empty names/values and dedupes by name (last wins)", () => {
    expect(
      assembleCookieHeader([
        { name: "MUSIC_U", value: "old" },
        { name: "", value: "skip" },
        { name: "drop", value: "" },
        { name: "MUSIC_U", value: "new" },
      ]),
    ).toBe("MUSIC_U=new");
  });

  it("is empty for no cookies", () => {
    expect(assembleCookieHeader([])).toBe("");
  });
});

describe("hasAuthCookie", () => {
  it("is true only when the named cookie has a value", () => {
    expect(hasAuthCookie([{ name: "MUSIC_U", value: "tok" }], "MUSIC_U")).toBe(true);
    expect(hasAuthCookie([{ name: "MUSIC_U", value: "" }], "MUSIC_U")).toBe(false);
    expect(hasAuthCookie([{ name: "other", value: "x" }], "MUSIC_U")).toBe(false);
  });
});

describe("cookieStringHasAuth", () => {
  it("detects the auth cookie inside a stored Cookie string", () => {
    expect(cookieStringHasAuth("os=pc; SESSDATA=abc; bili_jct=x", "SESSDATA")).toBe(true);
    expect(cookieStringHasAuth("os=pc; bili_jct=x", "SESSDATA")).toBe(false);
    expect(cookieStringHasAuth(undefined, "SESSDATA")).toBe(false);
    // Must match the cookie NAME, not a substring of another value.
    expect(cookieStringHasAuth("xSESSDATA=abc", "SESSDATA")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  assembleCookieHeader,
  cookieStringHasAuth,
  hasAuthCookie,
  STREAM_LOGIN_CONFIGS,
  streamSourcesAfterLogin,
  streamSourcesAfterLogout,
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

  it("wires qq (qqmusic_key) via the y.qq.com login window (Q4: login-window route)", () => {
    expect(STREAM_LOGIN_CONFIGS.qq).toMatchObject({ authCookie: "qqmusic_key" });
    expect(STREAM_LOGIN_CONFIGS.qq?.loginUrl).toContain("y.qq.com");
    expect(STREAM_LOGIN_CONFIGS.qq?.cookieUrls).toContain("https://y.qq.com");
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
    expect(cookieStringHasAuth("qqmusic_uin=1; qqmusic_key=W_X_t", "qqmusic_key")).toBe(true);
    expect(cookieStringHasAuth(undefined, "SESSDATA")).toBe(false);
    // Must match the cookie NAME, not a substring of another value.
    expect(cookieStringHasAuth("xSESSDATA=abc", "SESSDATA")).toBe(false);
  });
});

describe("streamSourcesAfterLogin", () => {
  it("stores the cookie, enables the source, keeps existing quality", () => {
    const out = streamSourcesAfterLogin(
      { netease: { quality: "lossless" } },
      "netease",
      "MUSIC_U=t",
      1234,
    );
    expect(out.netease).toEqual({
      quality: "lossless",
      cookie: "MUSIC_U=t",
      enabled: true,
      lastAuthAt: 1234,
    });
  });

  it("doesn't disturb other sources", () => {
    const out = streamSourcesAfterLogin({ bili: { enabled: true } }, "netease", "c", 1);
    expect(out.bili).toEqual({ enabled: true });
    expect(out.netease?.cookie).toBe("c");
  });
});

describe("streamSourcesAfterLogout", () => {
  it("drops the cookie + lastAuthAt but keeps quality/enabled", () => {
    const out = streamSourcesAfterLogout(
      { netease: { cookie: "x", lastAuthAt: 9, quality: "exhigh", enabled: true } },
      "netease",
    );
    expect(out.netease).toEqual({ quality: "exhigh", enabled: true });
  });

  it("is a no-op when the source has no config", () => {
    expect(streamSourcesAfterLogout({ bili: { enabled: true } }, "netease")).toEqual({
      bili: { enabled: true },
    });
  });
});

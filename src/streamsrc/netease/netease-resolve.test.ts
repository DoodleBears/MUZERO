import { describe, expect, it } from "vitest";
import {
  NETEASE_PLAYER_URL_PATH,
  neteasePlaybackBody,
  parseNeteasePlayback,
} from "./netease-resolve";

describe("neteasePlaybackBody", () => {
  it("builds the eapi player-url params for a song + quality level", () => {
    expect(neteasePlaybackBody(123456, "lossless")).toEqual({
      ids: "[123456]",
      level: "lossless",
      encodeType: "flac",
    });
    expect(NETEASE_PLAYER_URL_PATH).toBe("/api/song/enhance/player/url/v1");
  });
});

describe("parseNeteasePlayback", () => {
  it("returns a playable URL (https-upgraded) for code 200 with a url", () => {
    const res = parseNeteasePlayback({
      code: 200,
      data: [{ id: 1, url: "http://m7.music.126.net/x.flac", type: "flac", size: 4096, fee: 0 }],
    });
    expect(res).toEqual({
      kind: "success",
      url: "https://m7.music.126.net/x.flac",
      type: "flac",
      sizeBytes: 4096,
      preview: false,
    });
  });

  it("accepts a raw JSON string as well as an object", () => {
    const json = JSON.stringify({ code: 200, data: [{ url: "https://cdn/x.mp3", type: "mp3" }] });
    const res = parseNeteasePlayback(json);
    expect(res.kind).toBe("success");
  });

  it("flags a preview clip when freeTrialInfo is present", () => {
    const res = parseNeteasePlayback({
      code: 200,
      data: [{ url: "https://cdn/x.mp3", freeTrialInfo: { start: 0, end: 30 } }],
    });
    expect(res).toMatchObject({ kind: "success", preview: true });
  });

  it("maps code 301 to requires-login", () => {
    expect(parseNeteasePlayback({ code: 301 })).toEqual({ kind: "requires-login" });
  });

  it('treats a null / "null" url as no url', () => {
    expect(parseNeteasePlayback({ code: 200, data: [{ url: null, fee: 0 }] }).kind).not.toBe(
      "success",
    );
    expect(parseNeteasePlayback({ code: 200, data: [{ url: "null", fee: 0 }] }).kind).not.toBe(
      "success",
    );
  });

  it("maps a fee'd song with no url to no-permission (vip)", () => {
    expect(parseNeteasePlayback({ code: 200, data: [{ url: null, fee: 1 }] })).toEqual({
      kind: "no-permission",
      reason: "vip",
    });
  });

  it("maps a free-trial-only song (freeTrialPrivilege, fee 0) to no-permission (vip)", () => {
    expect(
      parseNeteasePlayback({
        code: 200,
        data: [{ url: null, br: 0, fee: 0, freeTrialPrivilege: { resConsumable: false } }],
      }),
    ).toEqual({ kind: "no-permission", reason: "vip" });
  });

  it("maps code 404 with no url to no-permission (unavailable)", () => {
    expect(parseNeteasePlayback({ code: 404, data: [{ url: null, fee: 0 }] })).toEqual({
      kind: "no-permission",
      reason: "unavailable",
    });
  });

  it("returns failure on invalid JSON", () => {
    expect(parseNeteasePlayback("not json {").kind).toBe("failure");
  });
});

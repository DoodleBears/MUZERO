import { describe, expect, it } from "vitest";
import {
  parseQqVkey,
  QQ_STREAM_FALLBACK_HOST,
  QQ_VKEY_METHOD,
  QQ_VKEY_MODULE,
  qqStreamHost,
  qqStreamUrl,
  qqVkeyRequestBody,
} from "./qq-resolve";

describe("qqVkeyRequestBody", () => {
  it("requests a vkey per filename with guest params", () => {
    const body = qqVkeyRequestBody(["M800XX.mp3", "M500XX.mp3"], { guid: "10000", songmid: "X" });
    expect(body.req_0.module).toBe(QQ_VKEY_MODULE);
    expect(body.req_0.method).toBe(QQ_VKEY_METHOD);
    expect(body.req_0.param.filename).toEqual(["M800XX.mp3", "M500XX.mp3"]);
    expect(body.req_0.param.songmid).toEqual(["X", "X"]);
    expect(body.req_0.param.uin).toBe("0");
    expect(body.req_0.param.guid).toBe("10000");
    expect(body.req_0.param.platform).toBe("20");
  });
});

describe("parseQqVkey", () => {
  it("extracts per-filename purls + sip from req_0.data", () => {
    const data = parseQqVkey({
      req_0: {
        data: {
          sip: ["http://ws.stream.qqmusic.qq.com/"],
          midurlinfo: [{ filename: "M800XX.mp3", purl: "M800XX.mp3?vkey=AAA&uin=0&fromtag=8" }],
        },
      },
    });
    expect(data?.sip).toEqual(["http://ws.stream.qqmusic.qq.com/"]);
    expect(data?.entries[0]).toEqual({
      filename: "M800XX.mp3",
      purl: "M800XX.mp3?vkey=AAA&uin=0&fromtag=8",
    });
  });
  it("keeps an empty purl (signals not-playable to the caller)", () => {
    const data = parseQqVkey({
      req_0: { data: { sip: [], midurlinfo: [{ filename: "F000XX.flac", purl: "" }] } },
    });
    expect(data?.entries[0].purl).toBe("");
  });
  it("returns null on invalid json / missing data", () => {
    expect(parseQqVkey("not json {")).toBeNull();
    expect(parseQqVkey({})).toBeNull();
  });
  it("accepts a raw JSON string", () => {
    const data = parseQqVkey(
      JSON.stringify({
        req_0: { data: { sip: ["https://dl.stream.qqmusic.qq.com/"], midurlinfo: [] } },
      }),
    );
    expect(data?.sip).toEqual(["https://dl.stream.qqmusic.qq.com/"]);
  });
});

describe("qqStreamHost", () => {
  it("prefers an https host", () => {
    expect(qqStreamHost(["http://a/", "https://b/"])).toBe("https://b/");
  });
  it("upgrades a http-only host to https", () => {
    expect(qqStreamHost(["http://ws.stream.qqmusic.qq.com/"])).toBe(
      "https://ws.stream.qqmusic.qq.com/",
    );
  });
  it("falls back when sip is empty", () => {
    expect(qqStreamHost([])).toBe(QQ_STREAM_FALLBACK_HOST);
  });
});

describe("qqStreamUrl", () => {
  it("joins host + purl without doubling slashes", () => {
    expect(qqStreamUrl(["https://dl.stream.qqmusic.qq.com/"], "M800XX.mp3?vkey=A")).toBe(
      "https://dl.stream.qqmusic.qq.com/M800XX.mp3?vkey=A",
    );
    expect(qqStreamUrl(["https://dl.stream.qqmusic.qq.com/"], "/M800XX.mp3")).toBe(
      "https://dl.stream.qqmusic.qq.com/M800XX.mp3",
    );
  });
});

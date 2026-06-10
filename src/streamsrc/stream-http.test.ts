import { describe, expect, it, vi } from "vitest";
import { aliasRestrictedHeaders, createStreamHttp } from "./stream-http";

describe("aliasRestrictedHeaders", () => {
  it("rewrites Cookie/User-Agent/Referer/Origin to x-muzero-h-* aliases", () => {
    expect(
      aliasRestrictedHeaders({
        Cookie: "MUSIC_U=x",
        "User-Agent": "UA",
        Referer: "https://music.163.com",
        Origin: "https://music.163.com",
        "Content-Type": "application/x-www-form-urlencoded",
      }),
    ).toEqual({
      "x-muzero-h-cookie": "MUSIC_U=x",
      "x-muzero-h-user-agent": "UA",
      "x-muzero-h-referer": "https://music.163.com",
      "x-muzero-h-origin": "https://music.163.com",
      "Content-Type": "application/x-www-form-urlencoded",
    });
  });

  it("is case-insensitive on the restricted names", () => {
    expect(aliasRestrictedHeaders({ cookie: "a", REFERER: "b" })).toEqual({
      "x-muzero-h-cookie": "a",
      "x-muzero-h-referer": "b",
    });
  });

  it("passes non-restricted headers through untouched", () => {
    expect(aliasRestrictedHeaders({ Accept: "application/json" })).toEqual({
      Accept: "application/json",
    });
  });
});

describe("createStreamHttp", () => {
  it("calls the shell fetch with aliased headers and adapts the response", async () => {
    const fetchFn = vi.fn(async () => ({
      status: 200,
      text: async () => '{"ok":1}',
      json: async () => ({ ok: 1 }),
    })) as unknown as typeof globalThis.fetch;
    const http = createStreamHttp(async () => fetchFn);

    const res = await http({
      url: "https://music.163.com/weapi/x",
      method: "POST",
      headers: { Cookie: "MUSIC_U=x", "Content-Type": "form" },
      body: "params=abc",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
    const [url, init] = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://music.163.com/weapi/x");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("params=abc");
    expect(init.headers).toEqual({ "x-muzero-h-cookie": "MUSIC_U=x", "Content-Type": "form" });
  });

  it("defaults the method to GET", async () => {
    const fetchFn = vi.fn(async () => ({
      status: 200,
      text: async () => "",
      json: async () => ({}),
    }));
    const http = createStreamHttp(async () => fetchFn as unknown as typeof globalThis.fetch);
    await http({ url: "https://api.bilibili.com/x" });
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls[0][1].method).toBe("GET");
  });
});

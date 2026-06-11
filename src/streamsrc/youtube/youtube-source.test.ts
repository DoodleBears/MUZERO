import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import type { StreamHttp, StreamHttpRequest, StreamHttpResponse } from "../http";
import { createYoutubeSource, type YoutubeRuntime } from "./youtube-source";

function res(json: unknown): StreamHttpResponse {
  const text = JSON.stringify(json);
  return { status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

const runtime: YoutubeRuntime = {
  resolveAudio: async (videoId) => ({
    kind: "ok",
    url: "https://cdn/a",
    mime: "audio/mp4",
    codec: "aac",
    expiresInSeconds: 3600,
    details: { videoId, lengthSeconds: 180, title: "Song One" },
  }),
};

const searchJson = {
  contents: {
    x: {
      videoRenderer: {
        videoId: "v1",
        title: { simpleText: "Song One" },
        lengthText: { simpleText: "3:00" },
      },
    },
  },
};

const okPlayer = {
  playabilityStatus: { status: "OK" },
  streamingData: {
    expiresInSeconds: "3600",
    adaptiveFormats: [
      {
        itag: 140,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128000,
        url: "https://cdn/a",
      },
    ],
  },
  videoDetails: { videoId: "v1", title: "Song One", lengthSeconds: "180" },
};

describe("createYoutubeSource", () => {
  afterEach(() => {
    clearTrace();
    vi.restoreAllMocks();
  });

  it("searches the keyed WEB endpoint and maps videoRenderers to hits", async () => {
    let lastReq: StreamHttpRequest | undefined;
    const http: StreamHttp = async (req) => {
      lastReq = req;
      return res(searchJson);
    };
    const source = createYoutubeSource({ http, now: () => 1000 });
    const hits = await source.search("song one");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "youtube", externalId: "v1", title: "Song One" });
    // The WEB client (not WEB_REMIX) + its API key are what make a real request
    // return `videoRenderer` nodes the parser walks.
    expect(lastReq?.url).toContain("/youtubei/v1/search");
    expect(lastReq?.url).toContain("key=");
    expect(lastReq?.headers?.["X-Youtube-Client-Name"]).toBe("1"); // WEB
  });

  it("resolves a videoId to a playable stream when the runtime is present", async () => {
    const http: StreamHttp = vi.fn(async () => res(okPlayer));
    const source = createYoutubeSource({ http, now: () => 1000, runtime });
    const result = await source.resolve("v1");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.stream.mediaUrl).toBe("https://cdn/a");
      expect(result.stream.mime).toBe("audio/mp4");
      expect(result.stream.expiresAt).toBe(1000 + 3600 * 1000);
      expect(result.stream.headers).toEqual({
        Accept: "*/*",
        Origin: "https://www.youtube.com",
        Referer: "https://www.youtube.com",
        DNT: "?1",
      });
    }
  });

  it("reports desktop-only when no runtime is injected", async () => {
    const http: StreamHttp = vi.fn(async () => res(okPlayer));
    const source = createYoutubeSource({ http, now: () => 0 });
    expect(await source.resolve("v1")).toMatchObject({ kind: "error" });
  });

  it("passes trace context to the runtime and records provider resolve", async () => {
    const http: StreamHttp = vi.fn(async () => res(okPlayer));
    const tracedRuntime: YoutubeRuntime = {
      resolveAudio: vi.fn(async () => ({
        kind: "ok" as const,
        url: "blob:http://localhost/youtube",
        mime: "audio/mp4",
        codec: "aac" as const,
      })),
    };
    const source = createYoutubeSource({ http, now: () => 1000, runtime: tracedRuntime });

    await source.resolve("v1", {
      trace: { traceId: "ply_1", trackId: "trk_1", sourceId: "youtube" },
    });

    expect(tracedRuntime.resolveAudio).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({
        trace: expect.objectContaining({ traceId: "ply_1", trackId: "trk_1" }),
      }),
    );
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "stream.youtube",
          event: "resolve.start",
          context: expect.objectContaining({
            traceId: "ply_1",
            trackId: "trk_1",
            sourceId: "youtube",
            videoId: "v1",
          }),
        }),
      ]),
    );
  });

  it("maps a login-gated video to requires-login", async () => {
    const http: StreamHttp = vi.fn(async () => res({}));
    const gated: YoutubeRuntime = { resolveAudio: async () => ({ kind: "login-required" }) };
    const source = createYoutubeSource({ http, now: () => 0, runtime: gated });
    expect(await source.resolve("v1")).toEqual({ kind: "requires-login" });
  });
});

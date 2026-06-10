import { describe, expect, it, vi } from "vitest";
import type { StreamHttp, StreamHttpResponse } from "../http";
import { createYoutubeSource, type YoutubeRuntime } from "./youtube-source";

function res(json: unknown): StreamHttpResponse {
  const text = JSON.stringify(json);
  return { status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

const runtime: YoutubeRuntime = {
  getBootstrap: async () => ({ visitorData: "VD", signatureTimestamp: 1 }),
  solvers: { solveSig: (s) => s, solveN: (n) => n },
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
  it("searches via InnerTube and maps videoRenderers to hits", async () => {
    const http: StreamHttp = vi.fn(async () => res(searchJson));
    const source = createYoutubeSource({ http, now: () => 1000 });
    const hits = await source.search("song one");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "youtube", externalId: "v1", title: "Song One" });
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
      expect(result.stream.headers?.Referer).toBe("https://www.youtube.com");
    }
  });

  it("reports desktop-only when no runtime is injected", async () => {
    const http: StreamHttp = vi.fn(async () => res(okPlayer));
    const source = createYoutubeSource({ http, now: () => 0 });
    expect(await source.resolve("v1")).toMatchObject({ kind: "error" });
  });

  it("maps a login-gated video to requires-login", async () => {
    const http: StreamHttp = vi.fn(async () =>
      res({ playabilityStatus: { status: "LOGIN_REQUIRED" } }),
    );
    const source = createYoutubeSource({ http, now: () => 0, runtime });
    expect(await source.resolve("v1")).toEqual({ kind: "requires-login" });
  });
});

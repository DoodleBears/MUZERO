import { describe, expect, it, vi } from "vitest";
import type { StreamHttp, StreamHttpResponse } from "../http";
import type { CipherSolvers } from "./youtube-cipher";
import { resolveYoutubeAudio } from "./youtube-resolve";

const solvers: CipherSolvers = {
  solveSig: (s) => s.split("").reverse().join(""),
  solveN: (n) => `${n}_ok`,
};

function res(json: unknown): StreamHttpResponse {
  const text = JSON.stringify(json);
  return { status: 200, text: async () => text, json: async () => JSON.parse(text) };
}

const okBody = (itag: number) => ({
  playabilityStatus: { status: "OK" },
  streamingData: {
    expiresInSeconds: "21540",
    adaptiveFormats: [
      {
        itag,
        mimeType: 'audio/mp4; codecs="mp4a.40.2"',
        bitrate: 128000,
        url: "https://cdn/a?n=th",
      },
    ],
  },
  videoDetails: { videoId: "v", title: "Song", author: "Artist", lengthSeconds: "200" },
});

describe("resolveYoutubeAudio", () => {
  const getBootstrap = async () => ({ visitorData: "VD", signatureTimestamp: 1, poToken: "P" });

  it("resolves the audio URL from the first client that serves", async () => {
    const http: StreamHttp = vi.fn(async () => res(okBody(140)));
    const out = await resolveYoutubeAudio("v", { http, getBootstrap, solvers });
    expect(out).toMatchObject({
      kind: "ok",
      mime: "audio/mp4",
      codec: "aac",
      expiresInSeconds: 21540,
      details: { title: "Song" },
    });
    // n param transformed by the injected solver.
    if (out.kind === "ok") expect(new URL(out.url).searchParams.get("n")).toBe("th_ok");
  });

  it("falls through to the next client on LOGIN_REQUIRED", async () => {
    const calls: number[] = [];
    const http: StreamHttp = vi.fn(async (req) => {
      const clientName = (
        JSON.parse(req.body ?? "{}") as { context: { client: { clientName: string } } }
      ).context.client.clientName;
      calls.push(clientName === "WEB_REMIX" ? 0 : 1);
      return clientName === "WEB_REMIX"
        ? res({ playabilityStatus: { status: "LOGIN_REQUIRED" } })
        : res(okBody(140));
    });
    const out = await resolveYoutubeAudio("v", { http, getBootstrap, solvers });
    expect(out.kind).toBe("ok");
    expect(calls).toEqual([0, 1]); // tried WEB_REMIX then TV
  });

  it("reports login-required when every client is gated", async () => {
    const http: StreamHttp = vi.fn(async () =>
      res({ playabilityStatus: { status: "LOGIN_REQUIRED" } }),
    );
    expect(await resolveYoutubeAudio("v", { http, getBootstrap, solvers })).toEqual({
      kind: "login-required",
    });
  });

  it("reports unavailable when OK but no audio format", async () => {
    const http: StreamHttp = vi.fn(async () =>
      res({
        playabilityStatus: { status: "OK" },
        streamingData: { formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1"' }] },
      }),
    );
    const out = await resolveYoutubeAudio("v", { http, getBootstrap, solvers });
    expect(out).toMatchObject({ kind: "unavailable" });
  });

  it("descrambles a ciphered stream before returning", async () => {
    const cipher = `s=ABC&sp=sig&url=${encodeURIComponent("https://cdn/a?n=th")}`;
    const http: StreamHttp = vi.fn(async () =>
      res({
        playabilityStatus: { status: "OK" },
        streamingData: {
          adaptiveFormats: [
            { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', signatureCipher: cipher },
          ],
        },
      }),
    );
    const out = await resolveYoutubeAudio("v", { http, getBootstrap, solvers });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(new URL(out.url).searchParams.get("sig")).toBe("CBA"); // reversed
  });
});

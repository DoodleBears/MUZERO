import { describe, expect, it } from "vitest";
import { buildPlayerRequestBody, parsePlayerResponse, YT_CLIENTS } from "./youtube-innertube";

describe("buildPlayerRequestBody", () => {
  it("builds the context + flags and includes the signatureTimestamp", () => {
    const body = buildPlayerRequestBody({
      videoId: "dQw4w9WgXcQ",
      client: YT_CLIENTS.webRemix,
      signatureTimestamp: 19834,
    }) as Record<string, never>;
    expect(body).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      contentCheckOk: true,
      racyCheckOk: true,
      context: {
        client: { clientName: "WEB_REMIX", hl: "en", gl: "US" },
      },
      playbackContext: { contentPlaybackContext: { signatureTimestamp: 19834 } },
    });
  });

  it("includes visitorData + poToken only when given", () => {
    const minimal = buildPlayerRequestBody({ videoId: "v", client: YT_CLIENTS.tv });
    expect(minimal).not.toHaveProperty("serviceIntegrityDimensions");
    expect((minimal.context as { client: object }).client).not.toHaveProperty("visitorData");

    const full = buildPlayerRequestBody({
      videoId: "v",
      client: YT_CLIENTS.tv,
      visitorData: "VD",
      poToken: "POT",
    });
    expect((full.context as { client: { visitorData: string } }).client.visitorData).toBe("VD");
    expect(full.serviceIntegrityDimensions).toEqual({ poToken: "POT" });
  });
});

describe("parsePlayerResponse", () => {
  const okResponse = {
    playabilityStatus: { status: "OK" },
    streamingData: {
      expiresInSeconds: "21540",
      adaptiveFormats: [
        {
          itag: 140,
          mimeType: 'audio/mp4; codecs="mp4a.40.2"',
          bitrate: 128000,
          url: "https://cdn/a",
        },
      ],
      formats: [{ itag: 18, mimeType: 'video/mp4; codecs="avc1"', bitrate: 500000 }],
    },
    videoDetails: {
      videoId: "abc",
      title: "Never Gonna Give You Up",
      author: "Rick Astley",
      lengthSeconds: "213",
      thumbnail: { thumbnails: [{ url: "https://t/sm" }, { url: "https://t/lg" }] },
    },
  };

  it("parses an OK response into formats + details + expiry", () => {
    const res = parsePlayerResponse(okResponse);
    expect(res.status).toBe("ok");
    expect(res.formats).toHaveLength(2); // adaptive + progressive merged
    expect(res.details).toEqual({
      videoId: "abc",
      title: "Never Gonna Give You Up",
      author: "Rick Astley",
      lengthSeconds: 213,
      thumbnailUrl: "https://t/lg", // largest (last) thumbnail
    });
    expect(res.expiresInSeconds).toBe(21540);
  });

  it("maps playability statuses to verdicts", () => {
    expect(parsePlayerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } }).status).toBe(
      "login-required",
    );
    expect(
      parsePlayerResponse({ playabilityStatus: { status: "AGE_CHECK_REQUIRED" } }).status,
    ).toBe("age-restricted");
    expect(
      parsePlayerResponse({ playabilityStatus: { status: "UNPLAYABLE", reason: "blocked" } }),
    ).toMatchObject({ status: "unplayable", reason: "blocked" });
    expect(parsePlayerResponse({ playabilityStatus: { status: "ERROR" } }).status).toBe("error");
    expect(parsePlayerResponse({}).status).toBe("error");
  });

  it("tolerates a response with no streamingData / videoDetails", () => {
    const res = parsePlayerResponse({ playabilityStatus: { status: "OK" } });
    expect(res.formats).toEqual([]);
    expect(res.details).toBeUndefined();
  });
});

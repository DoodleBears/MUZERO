import { describe, expect, it } from "vitest";
import { loadRemoteSetIndex, type SyncFetch, subscribeManifest } from "./r2-subscription";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fetchMap(entries: Record<string, unknown | Response>): SyncFetch {
  return async (input) => {
    const url = String(input);
    const hit = entries[url];
    if (!hit) return new Response("missing", { status: 404 });
    return hit instanceof Response ? hit : jsonResponse(hit);
  };
}

const manifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_abc",
  title: "Doodle Drive",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  baseUrl: "https://music.example.com/muzero/",
  sets: [
    {
      id: "ses_tokyo",
      title: "Tokyo Night Drive",
      index: "sets/ses_tokyo/index.json",
      updatedAt: "2026-06-09T00:00:00.000Z",
      trackCount: 2,
      bytes: 1234,
    },
  ],
};

const setIndex = {
  schema: "muzero-r2-set-index-v1",
  revision: 1,
  set: {
    id: "ses_tokyo",
    name: "Tokyo Night Drive",
    seedPrompt: "rainy Tokyo night drive",
    displayMode: "video",
    config: {
      autoExtend: true,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 60,
      allowVocals: true,
    },
    createdAt: 1780944000000,
    updatedAt: 1780944000000,
  },
  tracks: [
    {
      id: "trk_blue",
      title: "Blue Highway",
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      durationSec: 214,
      createdAt: 1780944000000,
      liked: true,
      tags: ["night"],
      media: {
        key: "objects/media/sha256-blue.mp3",
        url: "objects/media/sha256-blue.mp3",
        mime: "audio/mpeg",
        bytes: 8241123,
      },
      cover: {
        key: "objects/covers/blue.jpg",
        url: "objects/covers/blue.jpg",
        mime: "image/jpeg",
        bytes: 512221,
      },
      memories: [
        {
          id: "mem_1",
          note: "sea night",
          createdAt: 1780944000000,
          photo: {
            key: "objects/memories/mem_1.jpg",
            url: "objects/memories/mem_1.jpg",
            mime: "image/jpeg",
            bytes: 742001,
          },
        },
      ],
    },
  ],
};

describe("subscribeManifest", () => {
  it("loads a manifest preview from a public base URL", async () => {
    const preview = await subscribeManifest("https://music.example.com/muzero", {
      fetcher: fetchMap({
        "https://music.example.com/muzero/manifest.json": manifest,
      }),
    });

    expect(preview).toMatchObject({
      manifestUrl: "https://music.example.com/muzero/manifest.json",
      libraryId: "lib_abc",
      title: "Doodle Drive",
      setCount: 1,
      trackCount: 2,
      totalBytes: 1234,
    });
    expect(preview.sets[0]?.indexUrl).toBe(
      "https://music.example.com/muzero/sets/ses_tokyo/index.json",
    );
  });

  it("rejects invalid manifests without returning a preview", async () => {
    await expect(
      subscribeManifest("https://music.example.com/muzero/manifest.json", {
        fetcher: fetchMap({
          "https://music.example.com/muzero/manifest.json": { schema: "wrong" },
        }),
      }),
    ).rejects.toThrow(/invalid manifest/i);
  });
});

describe("loadRemoteSetIndex", () => {
  it("loads a set index and resolves streamable media URLs", async () => {
    const preview = await subscribeManifest("https://music.example.com/muzero/manifest.json", {
      fetcher: fetchMap({
        "https://music.example.com/muzero/manifest.json": manifest,
      }),
    });

    const remoteSet = await loadRemoteSetIndex(preview, preview.sets[0]!, {
      fetcher: fetchMap({
        "https://music.example.com/muzero/sets/ses_tokyo/index.json": setIndex,
      }),
    });

    expect(remoteSet.tracks[0]?.mediaUrl).toBe(
      "https://music.example.com/muzero/objects/media/sha256-blue.mp3",
    );
    expect(remoteSet.tracks[0]?.coverUrl).toBe(
      "https://music.example.com/muzero/objects/covers/blue.jpg",
    );
    expect(remoteSet.tracks[0]?.memoryPhotoUrls).toEqual([
      {
        memoryId: "mem_1",
        url: "https://music.example.com/muzero/objects/memories/mem_1.jpg",
      },
    ]);
  });

  it("rejects invalid set indexes", async () => {
    const preview = await subscribeManifest("https://music.example.com/muzero/manifest.json", {
      fetcher: fetchMap({
        "https://music.example.com/muzero/manifest.json": manifest,
      }),
    });

    await expect(
      loadRemoteSetIndex(preview, preview.sets[0]!, {
        fetcher: fetchMap({
          "https://music.example.com/muzero/sets/ses_tokyo/index.json": { schema: "wrong" },
        }),
      }),
    ).rejects.toThrow(/invalid set index/i);
  });
});

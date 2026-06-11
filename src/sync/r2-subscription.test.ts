import { describe, expect, it } from "vitest";
import {
  loadRemoteEntityCovers,
  loadRemoteIndexesForSearchTrack,
  loadRemoteSetIndex,
  type SyncFetch,
  subscribeManifest,
} from "./r2-subscription";

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

describe("loadRemoteEntityCovers", () => {
  const coversIndex = {
    schema: "muzero-r2-entity-covers-v1",
    updatedAt: 1780944000000,
    entries: [
      {
        id: "artist:deidian",
        kind: "artist",
        cover: {
          key: "objects/covers/sha256-aa.jpg",
          url: "objects/covers/sha256-aa.jpg",
          mime: "image/jpeg",
          bytes: 1024,
        },
        updatedAt: 1780944000000,
      },
    ],
  };

  it("loads the entity-covers index referenced by the manifest", async () => {
    const fetcher = fetchMap({
      "https://music.example.com/muzero/manifest.json": {
        ...manifest,
        entityCoversIndex: "library/entity-covers/index.json",
      },
      "https://music.example.com/muzero/library/entity-covers/index.json": coversIndex,
    });
    const preview = await subscribeManifest("https://music.example.com/muzero", { fetcher });

    const covers = await loadRemoteEntityCovers(preview, { fetcher });

    expect(covers).toMatchObject({
      baseUrl: "https://music.example.com/muzero/",
      index: { entries: [{ id: "artist:deidian", kind: "artist" }] },
    });
  });

  it("returns undefined when the manifest references no entity covers", async () => {
    const preview = await subscribeManifest("https://music.example.com/muzero", {
      fetcher: fetchMap({ "https://music.example.com/muzero/manifest.json": manifest }),
    });

    await expect(loadRemoteEntityCovers(preview)).resolves.toBeUndefined();
  });
});

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

  it("preserves set publisher identity in the preview for self-import dedupe", async () => {
    const preview = await subscribeManifest("https://music.example.com/muzero/manifest.json", {
      fetcher: fetchMap({
        "https://music.example.com/muzero/manifest.json": {
          ...manifest,
          sets: [{ ...manifest.sets[0], publishedBy: "dvc_local" }],
        },
      }),
    });

    expect(preview.sets[0]).toMatchObject({ id: "ses_tokyo", publishedBy: "dvc_local" });
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

describe("loadRemoteIndexesForSearchTrack", () => {
  it("lazy-loads only the set and share indexes referenced by a search result", async () => {
    const seen: string[] = [];
    const fetcher: SyncFetch = async (input) => {
      seen.push(String(input));
      return fetchMap({
        "https://music.example.com/muzero/manifest.json": {
          ...manifest,
          sets: [
            ...manifest.sets,
            {
              id: "ses_unused",
              title: "Unused Set",
              index: "sets/ses_unused/index.json",
              updatedAt: "2026-06-09T00:00:00.000Z",
              trackCount: 1,
              bytes: 555,
            },
          ],
        },
        "https://music.example.com/muzero/sets/ses_tokyo/index.json": setIndex,
        "https://shares.example.com/tokyo/share.json": {
          schema: "muzero-r2-share-manifest-v1",
          shareId: "shr_tokyo",
          title: "Tokyo share",
          createdAt: "2026-06-09T00:00:00.000Z",
          updatedAt: "2026-06-09T00:00:00.000Z",
          baseUrl: "https://shares.example.com/tokyo/",
          sourceSetId: "ses_tokyo",
          index: "index.json",
          capabilities: {
            readMedia: true,
            readMemories: true,
            writeStats: false,
            writePresence: false,
          },
        },
        "https://shares.example.com/tokyo/index.json": setIndex,
      })(input);
    };
    const preview = await subscribeManifest("https://music.example.com/muzero/manifest.json", {
      fetcher,
    });
    seen.length = 0;

    const result = await loadRemoteIndexesForSearchTrack(
      {
        preview,
        track: {
          setIds: ["ses_tokyo"],
          shareIds: ["shr_tokyo"],
        },
        shares: [
          {
            shareId: "shr_tokyo",
            manifestUrl: "https://shares.example.com/tokyo/share.json",
          },
        ],
      },
      { fetcher },
    );

    expect(result.sets.map((set) => set.index.set.id)).toEqual(["ses_tokyo"]);
    expect(result.shares.map((share) => share.shareId)).toEqual(["shr_tokyo"]);
    expect(seen).toEqual([
      "https://music.example.com/muzero/sets/ses_tokyo/index.json",
      "https://shares.example.com/tokyo/share.json",
      "https://shares.example.com/tokyo/index.json",
    ]);
  });
});

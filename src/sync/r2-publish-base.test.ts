import { describe, expect, it } from "vitest";
import { createRemotePublishBaseCache, fetchRemotePublishBase } from "./r2-publish-base";
import type { SyncFetch } from "./r2-subscription";

const credentials = {
  accountId: "acct",
  bucket: "muzero",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const BASE = "https://acct.r2.cloudflarestorage.com/muzero";

const manifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_abc",
  title: "Drive",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-10T00:00:00.000Z",
  baseUrl: "https://music.example.com/muzero/",
  devicesIndex: "devices/index.json",
  sets: [
    {
      id: "ses_theirs",
      title: "Their set",
      index: "sets/ses_theirs/index.json",
      updatedAt: "2026-06-10T00:00:00.000Z",
      trackCount: 3,
      bytes: 300,
      publishedBy: "dvc_a",
    },
  ],
};

const devicesIndex = {
  schema: "muzero-r2-devices-v1",
  updatedAt: 1000,
  devices: [{ publicId: "dvc_a", displayName: "Studio laptop", lastSeenAt: 1000 }],
};

const orphanSetIndex = {
  schema: "muzero-r2-set-index-v1",
  set: {
    id: "ses_orphan",
    name: "Recovered set",
    seedPrompt: "",
    displayMode: "cover",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 60,
      allowVocals: true,
    },
    createdAt: 1000,
    updatedAt: 2000,
  },
  tracks: [],
  revision: 1,
  updatedAt: 2000,
};

function jsonResponse(body: unknown, etag?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...(etag ? { etag } : {}),
    },
  });
}

function fetchMap(
  entries: Record<string, () => Response>,
  seen?: Array<{ url: string; method?: string; authorization: string | null }>,
): SyncFetch {
  return async (input, init) => {
    const url = String(input);
    seen?.push({
      url,
      method: init?.method,
      authorization: new Headers(init?.headers).get("authorization"),
    });
    const hit = entries[url];
    return hit ? hit() : new Response("missing", { status: 404 });
  };
}

describe("fetchRemotePublishBase", () => {
  it("reads manifest + discovery indexes via signed GETs and captures ETags", async () => {
    const seen: Array<{ url: string; method?: string; authorization: string | null }> = [];
    const base = await fetchRemotePublishBase({
      credentials,
      fetcher: fetchMap(
        {
          [`${BASE}/manifest.json`]: () => jsonResponse(manifest, '"etag-manifest"'),
          [`${BASE}/devices/index.json`]: () => jsonResponse(devicesIndex, '"etag-devices"'),
        },
        seen,
      ),
    });

    expect(base.manifest?.value.libraryId).toBe("lib_abc");
    expect(base.manifest?.value.sets[0]?.publishedBy).toBe("dvc_a");
    expect(base.manifest?.etag).toBe('"etag-manifest"');
    expect(base.devicesIndex?.value.devices[0]?.publicId).toBe("dvc_a");
    expect(base.devicesIndex?.etag).toBe('"etag-devices"');
    // Manifest-discovered indexes are read; omitted manifest pointers are not guessed.
    expect(base.statsIndex).toBeUndefined();
    expect(base.presenceIndex).toBeUndefined();

    // Every read is a signed S3 GET (private-bucket-ready), not a public fetch.
    expect(seen.every((call) => call.method === "GET")).toBe(true);
    expect(seen.every((call) => call.authorization?.startsWith("AWS4-HMAC-SHA256"))).toBe(true);
    expect(seen.map((call) => call.url).sort()).toEqual([
      `${BASE}/devices/index.json`,
      `${BASE}/manifest.json`,
    ]);
  });

  it("uses ETag conditional reads and cached validated objects on 304", async () => {
    const cache = createRemotePublishBaseCache();
    await fetchRemotePublishBase({
      credentials,
      cache,
      fetcher: fetchMap({
        [`${BASE}/manifest.json`]: () => jsonResponse(manifest, '"etag-manifest"'),
        [`${BASE}/devices/index.json`]: () => jsonResponse(devicesIndex, '"etag-devices"'),
      }),
    });

    const seen: Array<{ url: string; ifNoneMatch: string | null }> = [];
    const base = await fetchRemotePublishBase({
      credentials,
      cache,
      fetcher: async (input, init) => {
        seen.push({
          url: String(input),
          ifNoneMatch: new Headers(init?.headers).get("if-none-match"),
        });
        return new Response(null, { status: 304 });
      },
    });

    expect(base.manifest?.value.libraryId).toBe("lib_abc");
    expect(base.devicesIndex?.value.devices[0]?.publicId).toBe("dvc_a");
    expect(seen).toEqual([
      { url: `${BASE}/manifest.json`, ifNoneMatch: '"etag-manifest"' },
      { url: `${BASE}/devices/index.json`, ifNoneMatch: '"etag-devices"' },
    ]);
  });

  it("treats a missing manifest as an empty first-publish base without probing indexes", async () => {
    const seen: Array<{ url: string; method?: string; authorization: string | null }> = [];
    const base = await fetchRemotePublishBase({
      credentials,
      fetcher: fetchMap({}, seen),
      setRemoteIds: ["ses_missing"],
    });

    expect(base).toEqual({});
    expect(seen.map((call) => call.url)).toEqual([`${BASE}/manifest.json`]);
  });

  it("probes requested set indexes even when the manifest does not reference them yet", async () => {
    const seen: Array<{ url: string; method?: string; authorization: string | null }> = [];
    const base = await fetchRemotePublishBase({
      credentials,
      fetcher: fetchMap(
        {
          [`${BASE}/manifest.json`]: () => jsonResponse({ ...manifest, sets: [] }, '"m1"'),
          [`${BASE}/sets/ses_orphan/index.json`]: () => jsonResponse(orphanSetIndex, '"s1"'),
        },
        seen,
      ),
      setRemoteIds: ["ses_orphan"],
    });

    expect(base.manifest?.etag).toBe('"m1"');
    expect(base.setIndexes?.ses_orphan).toMatchObject({
      etag: '"s1"',
      value: { set: { id: "ses_orphan", name: "Recovered set" } },
    });
    expect(seen.map((call) => call.url).sort()).toEqual([
      `${BASE}/devices/index.json`,
      `${BASE}/manifest.json`,
      `${BASE}/sets/ses_orphan/index.json`,
    ]);
  });

  it("treats an unparseable remote object as absent (recoverable by overwrite)", async () => {
    const base = await fetchRemotePublishBase({
      credentials,
      fetcher: fetchMap({
        [`${BASE}/manifest.json`]: () => jsonResponse({ schema: "garbage" }),
      }),
    });
    expect(base.manifest).toBeUndefined();
  });

  it("throws on a non-404 read failure instead of risking a blind overwrite", async () => {
    await expect(
      fetchRemotePublishBase({
        credentials,
        fetcher: fetchMap({
          [`${BASE}/manifest.json`]: () => new Response(null, { status: 500 }),
        }),
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

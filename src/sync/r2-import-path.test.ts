import { describe, expect, it, vi } from "vitest";

// "Tauri/Electron use the same manifest import path" means there is ONE set of
// read functions whose only platform-specific dependency is `getAppFetch()` —
// the shim that resolves to the Tauri http plugin inside a WebView and to
// `globalThis.fetch` in a plain browser / Electron. These tests prove the import
// readers default to that shared abstraction (so no fork per runtime) while still
// honoring an explicitly injected fetcher.

const BASE_URL = "https://drive.example.com/muzero/";
const MANIFEST_URL = "https://drive.example.com/muzero/manifest.json";
const SET_INDEX_URL = "https://drive.example.com/muzero/sets/ses_tokyo/index.json";

const manifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_abc",
  title: "Doodle Drive",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  baseUrl: BASE_URL,
  sets: [
    {
      id: "ses_tokyo",
      title: "Tokyo Night Drive",
      index: "sets/ses_tokyo/index.json",
      updatedAt: "2026-06-09T00:00:00.000Z",
      trackCount: 1,
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
    seedPrompt: "",
    displayMode: "video",
    config: {
      autoExtend: false,
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
      liked: false,
      tags: [],
      media: { url: "objects/media/blue.mp3", mime: "audio/mpeg", bytes: 8241123 },
    },
  ],
};

// Stand in for the platform fetch shim; records that the import path resolved its
// fetch through `getAppFetch()` rather than reaching for a runtime-specific fetch.
const platform = vi.hoisted(() => {
  const fixtures: Record<string, unknown> = {};
  const calls = { getAppFetch: 0, urls: [] as string[] };
  const getAppFetch = vi.fn(async () => {
    calls.getAppFetch += 1;
    return (async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      calls.urls.push(url);
      const body = fixtures[url];
      if (body === undefined) return new Response("missing", { status: 404 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
  });
  return { fixtures, calls, getAppFetch };
});

vi.mock("@/lib/platform", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/platform")>();
  return { ...actual, getAppFetch: platform.getAppFetch };
});

const { loadRemoteSetIndex, subscribeManifest } = await import("./r2-subscription");

function resetPlatform() {
  platform.calls.getAppFetch = 0;
  platform.calls.urls = [];
  platform.fixtures[MANIFEST_URL] = manifest;
  platform.fixtures[SET_INDEX_URL] = setIndex;
}

describe("manifest import path shares the platform fetch (browser/Tauri/Electron)", () => {
  it("subscribeManifest defaults to getAppFetch when no fetcher is injected", async () => {
    resetPlatform();

    const preview = await subscribeManifest(MANIFEST_URL);

    expect(platform.getAppFetch).toHaveBeenCalled();
    expect(platform.calls.urls).toContain(MANIFEST_URL);
    expect(preview.libraryId).toBe("lib_abc");
  });

  it("loadRemoteSetIndex defaults to the same platform fetch", async () => {
    resetPlatform();
    const preview = await subscribeManifest(MANIFEST_URL);
    platform.calls.getAppFetch = 0;
    platform.calls.urls = [];

    const set = await loadRemoteSetIndex(preview, preview.sets[0]!);

    expect(platform.calls.getAppFetch).toBeGreaterThan(0);
    expect(platform.calls.urls).toContain(SET_INDEX_URL);
    expect(set.tracks[0]?.mediaUrl).toBe("https://drive.example.com/muzero/objects/media/blue.mp3");
  });

  it("honors an explicitly injected fetcher without falling back to the platform fetch", async () => {
    resetPlatform();
    const seen: string[] = [];
    const fetcher = (async (input: RequestInfo | URL): Promise<Response> => {
      seen.push(String(input));
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    await subscribeManifest(MANIFEST_URL, { fetcher });

    expect(seen).toContain(MANIFEST_URL);
    expect(platform.calls.getAppFetch).toBe(0);
  });
});

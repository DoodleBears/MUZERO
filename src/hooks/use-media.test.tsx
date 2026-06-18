import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearRemoteCoverAssetCacheForTests } from "@/lib/cover-asset";
import { readPerfCounter, resetPerfCounters, setPerfCountersEnabled } from "@/lib/perf-counters";
import { clearTrace, getTraceEntries } from "@/lib/trace";

// A stable blob the mocked liveQuery hands back (as if mediaBlobs.get resolved).
const { coverBlob, liveQueryState, derivState, remoteCoverState, desktopBridgeState } = vi.hoisted(
  () => ({
    coverBlob: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    liveQueryState: {
      blob: undefined as Blob | null | undefined,
      id: undefined as string | undefined,
    },
    // What the mocked derivative resolver returns (the hook only reads `.blob`).
    derivState: {
      // biome-ignore lint/suspicious/noExplicitAny: minimal canned ResolvedCoverDerivative
      resolved: undefined as any,
    },
    remoteCoverState: {
      fetcher: vi.fn(),
    },
    desktopBridgeState: {
      localMediaUrl: vi.fn(),
    },
  }),
);

// Isolate the hook from Dexie + settings: the blob is "already resolved", and
// covers render uncropped so no canvas (jsdom has none) is touched.
vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: () => unknown, deps?: unknown[]) => {
    if (liveQueryState.blob === undefined) return undefined;
    if (liveQueryState.blob === null) return null;
    return {
      blob: liveQueryState.blob,
      id: liveQueryState.id ?? (typeof deps?.[0] === "string" ? deps[0] : "blb_test"),
    };
  },
}));
vi.mock("@/hooks/use-app-data", () => ({ useSettings: () => ({ coverCropped: false }) }));
vi.mock("@/lib/platform", () => ({
  getAppFetch: async () => remoteCoverState.fetcher,
}));
vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    kind: "electron",
    localMediaUrl: desktopBridgeState.localMediaUrl,
    openExternal: vi.fn(),
  }),
}));
// Keep the real key helpers (the synchronous cache key must stay accurate); only the
// async resolver is canned so no worker/canvas runs in jsdom.
vi.mock("@/db/cover-derivatives", async (importActual) => ({
  ...(await importActual<typeof import("@/db/cover-derivatives")>()),
  ensureCoverThumbnailDerivative: vi.fn(async () => derivState.resolved),
  ensureCoverBacklightDerivative: vi.fn(async () => derivState.resolved),
}));

import { ensureCoverThumbnailDerivative } from "@/db/cover-derivatives";
import {
  useCoverDerivativeUrl,
  useTrackCoverResource,
  useTrackCoverUrl,
  useTrackMediaUrl,
} from "./use-media";

let created = 0;

beforeEach(() => {
  clearRemoteCoverAssetCacheForTests();
  created = 0;
  clearTrace();
  resetPerfCounters();
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:cover-${++created}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  liveQueryState.blob = coverBlob;
  liveQueryState.id = undefined;
  remoteCoverState.fetcher.mockResolvedValue({
    headers: { get: () => "image/jpeg" },
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array([4, 5, 6])], { type: "image/jpeg" }),
  });
  desktopBridgeState.localMediaUrl.mockResolvedValue("http://127.0.0.1/local/mv.mp4");
});

afterEach(() => {
  setPerfCountersEnabled(false);
  resetPerfCounters();
  vi.restoreAllMocks();
});

describe("useTrackCoverUrl — cross-mount object-URL cache (Phase 1)", () => {
  it("reuses the cached URL across re-mounts: created once, returned synchronously, not revoked on unmount", async () => {
    // Unique id keeps the module-singleton cache isolated from other cases.
    const track = { coverBlobId: "blb_remount_a" };

    const first = renderHook(() => useTrackCoverUrl(track));
    await act(async () => {}); // flush the async produce → store
    const url = first.result.current;
    expect(url).toMatch(/^blob:cover-/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    first.unmount();
    // The cache owns the URL now — unmount must NOT revoke a still-cached cover.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // Re-mount (the "switch back to this tab" case): the URL is available on the
    // very first render, with no second createObjectURL.
    const second = renderHook(() => useTrackCoverUrl(track));
    expect(second.result.current).toBe(url);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("downloads a remote cover through app fetch and returns a cached object URL", async () => {
    liveQueryState.blob = null;
    const { result } = renderHook(() =>
      useTrackCoverUrl({ remoteCoverUrl: "https://example.com/c.jpg" }),
    );
    expect(result.current).toBeNull();

    await act(async () => {});

    expect(result.current).toBe("blob:cover-1");
    expect(remoteCoverState.fetcher).toHaveBeenCalledWith("https://example.com/c.jpg", {
      cache: "force-cache",
    });
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("falls back to the direct remote URL when the blob fetch fails (web/CORS), still ready", async () => {
    // A failed blob fetch is the WEB case: no `muzfetch://` proxy, so a cross-origin R2
    // cover fails CORS on fetch(). The cover is still displayable via <img> (no CORS
    // needed), so the hook returns the direct URL instead of null — otherwise the stage
    // would fall through to the thumbhash / title card even though the art is reachable.
    remoteCoverState.fetcher.mockResolvedValue({
      headers: { get: () => "text/html" },
      ok: true,
      status: 200,
      blob: async () => new Blob(["not image"], { type: "text/html" }),
    });

    const { result } = renderHook(() =>
      useTrackCoverResource({ id: "trk_remote_fail", remoteCoverUrl: "https://example.com/nope" }),
    );

    expect(result.current.readyForTrack).toBe(false);

    await act(async () => {});

    expect(result.current.url).toBe("https://example.com/nope");
    expect(result.current.readyForTrack).toBe(true);
  });

  it("leak audit: churning a grid (many mount/unmount cycles) stays bounded", async () => {
    const track = { coverBlobId: "blb_leak_audit" };
    // Mount + unmount the same cover many times, as scrolling/tab-switching does.
    for (let i = 0; i < 8; i++) {
      const r = renderHook(() => useTrackCoverUrl(track));
      await act(async () => {});
      expect(r.result.current).toMatch(/^blob:cover-/);
      r.unmount();
    }
    // One URL total (the cache reused it every time); none revoked while it lived.
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("keeps the previous local cover while the next cover blob is still resolving", async () => {
    const { rerender, result } = renderHook(({ track }) => useTrackCoverUrl(track), {
      initialProps: { track: { coverBlobId: "blb_hold_a" } },
    });

    await act(async () => {});
    const firstUrl = result.current;
    expect(firstUrl).toMatch(/^blob:cover-/);

    liveQueryState.blob = undefined;
    rerender({ track: { coverBlobId: "blb_hold_b" } });

    expect(result.current).toBe(firstUrl);

    liveQueryState.blob = null;
    rerender({ track: { coverBlobId: "blb_hold_b" } });

    expect(result.current).toBeNull();
  });

  it("marks the held previous local cover as stale until the current track cover resolves", async () => {
    const { rerender, result } = renderHook(({ track }) => useTrackCoverResource(track), {
      initialProps: { track: { coverBlobId: "blb_resource_a" } },
    });

    await act(async () => {});
    const first = result.current;
    expect(first.url).toMatch(/^blob:cover-/);
    expect(first.readyForTrack).toBe(true);
    expect(first.staleWhilePending).toBe(false);
    expect(first.targetKey).toBe("blb_resource_a");
    expect(first.urlKey).toBe("blb_resource_a");

    liveQueryState.blob = undefined;
    rerender({ track: { coverBlobId: "blb_resource_b" } });

    expect(result.current.url).toBe(first.url);
    expect(result.current.readyForTrack).toBe(false);
    expect(result.current.staleWhilePending).toBe(true);
    expect(result.current.targetKey).toBe("blb_resource_b");
    expect(result.current.urlKey).toBe("blb_resource_a");
  });

  it("ignores a stale liveQuery cover blob whose id belongs to the previous track", async () => {
    const { rerender, result } = renderHook(({ track }) => useTrackCoverResource(track), {
      initialProps: { track: { coverBlobId: "blb_guard_a" } },
    });

    await act(async () => {});
    const first = result.current;
    expect(first.url).toBe("blob:cover-1");
    expect(first.urlKey).toBe("blb_guard_a");

    liveQueryState.id = "blb_guard_a";
    rerender({ track: { coverBlobId: "blb_guard_b" } });

    expect(result.current.url).toBe(first.url);
    expect(result.current.readyForTrack).toBe(false);
    expect(result.current.staleWhilePending).toBe(true);
    expect(result.current.targetKey).toBe("blb_guard_b");
    expect(result.current.urlKey).toBe("blb_guard_a");
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    liveQueryState.id = "blb_guard_b";
    liveQueryState.blob = new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" });
    rerender({ track: { coverBlobId: "blb_guard_b" } });
    await act(async () => {});

    expect(result.current.url).toBe("blob:cover-2");
    expect(result.current.readyForTrack).toBe(true);
    expect(result.current.staleWhilePending).toBe(false);
    expect(result.current.urlKey).toBe("blb_guard_b");
  });

  it("does not hold a previous cover for remote-backed online tracks while their local blob resolves", async () => {
    const { rerender, result } = renderHook(({ track }) => useTrackCoverResource(track), {
      initialProps: { track: { coverBlobId: "blb_online_a" } },
    });

    await act(async () => {});
    const first = result.current;
    expect(first.url).toMatch(/^blob:cover-/);

    liveQueryState.blob = undefined;
    rerender({
      track: {
        coverBlobId: "blb_online_b",
        remoteCoverUrl: "https://example.com/b.jpg",
      },
    });

    expect(result.current.url).toBeNull();
    expect(result.current.readyForTrack).toBe(true);
    expect(result.current.staleWhilePending).toBe(false);
  });

  it("records cover render cache miss and hit diagnostics by surface when enabled", async () => {
    setPerfCountersEnabled(true);
    const track = { id: "trk_cover_trace", coverBlobId: "blb_cover_trace" };

    const first = renderHook(() => useTrackCoverUrl(track, "row"));
    await act(async () => {});
    expect(first.result.current).toMatch(/^blob:cover-/);
    expect(readPerfCounter("cover.render.row.cache-miss")).toBe(1);
    first.unmount();

    const second = renderHook(() => useTrackCoverUrl(track, "row"));
    await act(async () => {});
    expect(second.result.current).toBe(first.result.current);
    expect(readPerfCounter("cover.render.row.cache-hit")).toBe(1);
    expect(getTraceEntries().map((entry) => [entry.scope, entry.message])).toContainEqual([
      "cover.render",
      "cache-hit",
    ]);
    second.unmount();
  });
});

describe("useTrackMediaUrl", () => {
  it("resolves referenced local-file media through the desktop bridge", async () => {
    liveQueryState.blob = null;
    const { result } = renderHook(() =>
      useTrackMediaUrl({
        blobId: undefined,
        kind: "video",
        mediaMetadata: { originalMime: "video/x-matroska", parser: "manual", parsedAt: 1 },
        remoteMediaUrl: undefined,
        sourcePath: "D:/media/mv.mkv",
      }),
    );

    expect(result.current).toBeNull();
    await act(async () => {});

    expect(result.current).toBe("http://127.0.0.1/local/mv.mp4");
    expect(desktopBridgeState.localMediaUrl).toHaveBeenCalledWith({
      mime: "video/x-matroska",
      path: "D:/media/mv.mkv",
    });
  });
});

describe("useCoverDerivativeUrl — cross-mount derivative cache (back-nav flash fix)", () => {
  it("resolves once, returns the URL synchronously on re-mount, never revoked on unmount", async () => {
    derivState.resolved = {
      blob: new Blob([new Uint8Array([9])], { type: "image/webp" }),
      blobId: "blb_dv_a",
      derivative: {},
    };
    const track = { id: "trk_dv_a", coverBlobId: "blb_grid_a" };

    const first = renderHook(() => useCoverDerivativeUrl(track, "thumbnail"));
    // Frame 0 is a cache miss → null (CoverImage shows the thumbhash placeholder).
    expect(first.result.current).toBeNull();
    await act(async () => {}); // flush ensure() → store
    const url = first.result.current;
    expect(url).toMatch(/^blob:cover-/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    first.unmount();
    // The cache owns the URL now — unmount must NOT revoke a still-cached thumbnail.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    // Re-mount (returning from a detail page): the URL is there on the very FIRST
    // render, with no second decode — this is what removes the placeholder flash.
    const second = renderHook(() => useCoverDerivativeUrl(track, "thumbnail"));
    expect(second.result.current).toBe(url);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("does not start derivative work while deferring (scrolling); resolves once settled", async () => {
    derivState.resolved = {
      blob: new Blob([new Uint8Array([7])], { type: "image/webp" }),
      blobId: "blb_dv_b",
      derivative: {},
    };
    const ensure = vi.mocked(ensureCoverThumbnailDerivative);
    ensure.mockClear();
    const track = { id: "trk_dv_b", coverBlobId: "blb_grid_b" };

    const { rerender, result } = renderHook(
      ({ defer }) => useCoverDerivativeUrl(track, "thumbnail", { defer }),
      { initialProps: { defer: true } },
    );
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(ensure).not.toHaveBeenCalled(); // scrolling: no expensive decode

    rerender({ defer: false }); // scroll settled
    await act(async () => {});
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(result.current).toMatch(/^blob:cover-/);
  });
});

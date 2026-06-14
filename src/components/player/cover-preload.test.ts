import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedMediaBlob } from "@/db/media-blob-storage";
import { ObjectUrlCache } from "@/lib/object-url-cache";
import {
  type CoverPreloadRequest,
  filterCoverPreloadRequestsForBurst,
  preloadCoverBatch,
} from "./cover-preload";

function request(key: string): CoverPreloadRequest {
  return {
    coverBlobId: key,
    key,
    role: "current",
    trackId: `trk_${key}`,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resolvedCover(id: string, blob: Blob): ResolvedMediaBlob {
  return {
    blob,
    bytes: blob.size,
    id,
    mime: blob.type || "image/png",
    role: "cover",
    storageBackend: "indexeddb",
    trackId: `trk_${id}`,
  };
}

describe("cover preload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dedupes concurrent local cover loads by cache key", async () => {
    const cache = new ObjectUrlCache({ revoke: vi.fn() });
    const created = vi.fn(() => "blob:cover-1");
    const gate = deferred<void>();
    const resolveMediaBlob = vi.fn(async () => {
      await gate.promise;
      return resolvedCover("blb_shared", new Blob(["cover"], { type: "image/png" }));
    });
    const coverRequest = request("blb_shared");

    const first = preloadCoverBatch({
      cache,
      createObjectURL: created,
      delay: async () => {},
      isCurrent: () => true,
      previous: {},
      requests: [coverRequest],
      resolveMediaBlob,
    });
    const second = preloadCoverBatch({
      cache,
      createObjectURL: created,
      delay: async () => {},
      isCurrent: () => true,
      previous: {},
      requests: [coverRequest],
      resolveMediaBlob,
    });

    await Promise.resolve();
    gate.resolve();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(resolveMediaBlob).toHaveBeenCalledTimes(1);
    expect(created).toHaveBeenCalledTimes(1);
    expect(firstResult.entries.trk_blb_shared?.url).toBe("blob:cover-1");
    expect(secondResult.entries.trk_blb_shared?.url).toBe("blob:cover-1");
    expect(firstResult.stats.created + secondResult.stats.created).toBe(1);
    expect(firstResult.stats.inflightHits + secondResult.stats.inflightHits).toBe(1);
  });

  it("does not create an object URL after a batch becomes stale", async () => {
    const cache = new ObjectUrlCache({ revoke: vi.fn() });
    const created = vi.fn(() => "blob:stale");
    const gate = deferred<void>();
    let current = true;
    const resolveMediaBlob = vi.fn(async () => {
      await gate.promise;
      return resolvedCover("blb_stale", new Blob(["stale"], { type: "image/png" }));
    });

    const pending = preloadCoverBatch({
      cache,
      createObjectURL: created,
      delay: async () => {},
      isCurrent: () => current,
      previous: {},
      requests: [request("blb_stale")],
      resolveMediaBlob,
    });

    await Promise.resolve();
    current = false;
    gate.resolve();
    const result = await pending;

    expect(created).not.toHaveBeenCalled();
    expect(result.canceled).toBe(true);
    expect(result.stats.stale).toBe(1);
    expect(cache.refCount("blb_stale")).toBe(0);
  });

  it("delays non-current local cover reads so stale batches cancel before loading large blobs", async () => {
    vi.useFakeTimers();
    const cache = new ObjectUrlCache({ revoke: vi.fn() });
    const resolveMediaBlob = vi.fn(async () =>
      resolvedCover("blb_large_next", new Blob(["large"], { type: "image/jpeg" })),
    );
    let current = true;
    const nextRequest: CoverPreloadRequest = {
      ...request("blb_large_next"),
      role: "next",
      trackId: "trk_next",
    };

    const pending = preloadCoverBatch({
      cache,
      delay: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      isCurrent: () => current,
      nonCurrentLocalSettleMs: 420,
      previous: {},
      requests: [nextRequest],
      resolveMediaBlob,
    });

    await vi.advanceTimersByTimeAsync(419);
    expect(resolveMediaBlob).not.toHaveBeenCalled();

    current = false;
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;

    expect(resolveMediaBlob).not.toHaveBeenCalled();
    expect(result.canceled).toBe(true);
    expect(result.stats.canceled).toBe(1);
    expect(result.stats.maxSourceBytes).toBe(0);
    expect(cache.refCount("blb_large_next")).toBe(0);
  });

  it("filters non-current local requests during a switch burst but keeps current and remote covers", () => {
    const current = request("blb_current");
    const nextLocal: CoverPreloadRequest = {
      ...request("blb_next"),
      role: "next",
      trackId: "trk_next",
    };
    const previousRemote: CoverPreloadRequest = {
      key: "trk_prev:remote:https://x/cover.jpg",
      remoteUrl: "https://x/cover.jpg",
      role: "previous",
      trackId: "trk_prev",
    };

    expect(filterCoverPreloadRequestsForBurst([current, nextLocal, previousRemote], false)).toEqual(
      [current, previousRemote],
    );
    expect(filterCoverPreloadRequestsForBurst([current, nextLocal, previousRemote], true)).toEqual([
      current,
      nextLocal,
      previousRemote,
    ]);
  });
});

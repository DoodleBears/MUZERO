import { describe, expect, it, vi } from "vitest";
import type { ResolvedMediaBlob } from "@/db/media-blob-storage";
import { ObjectUrlCache } from "@/lib/object-url-cache";
import { type CoverPreloadRequest, preloadCoverBatch } from "./cover-preload";

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
});

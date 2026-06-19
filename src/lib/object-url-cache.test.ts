import { describe, expect, it, vi } from "vitest";
import { ObjectUrlCache } from "./object-url-cache";

/**
 * The cache is the heart of Phase 1 (instant-cover-thumbnails PRD): it lets a
 * cover URL survive component unmount so a re-mount (tab switch, detail back-out)
 * returns it synchronously instead of re-fetching the blob. `revoke` is injected
 * so these stay pure (jsdom has no `URL.revokeObjectURL`), matching the DjEngine
 * "inject the side effect" discipline.
 */
describe("ObjectUrlCache", () => {
  it("returns undefined for an unknown key", () => {
    const cache = new ObjectUrlCache({ capacity: 4 });
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("stores a url and reads it back", () => {
    const cache = new ObjectUrlCache({ capacity: 4 });
    cache.store("a", "blob:a");
    expect(cache.get("a")).toBe("blob:a");
    expect(cache.size).toBe(1);
  });

  it("dedupes a second store for the same key — revokes the late duplicate, keeps the first", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 4, revoke });
    cache.store("a", "blob:a1");
    const canonical = cache.store("a", "blob:a2");
    expect(canonical).toBe("blob:a1");
    expect(cache.get("a")).toBe("blob:a1");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a2");
    expect(cache.size).toBe(1);
  });

  it("does not revoke when the same url is stored twice", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 4, revoke });
    cache.store("a", "blob:a");
    cache.store("a", "blob:a");
    expect(revoke).not.toHaveBeenCalled();
  });

  it("ref-counts: acquire before a url exists, then store, then release", () => {
    const cache = new ObjectUrlCache({ capacity: 4 });
    expect(cache.acquire("a")).toBeUndefined(); // interest registered before bytes resolve
    expect(cache.refCount("a")).toBe(1);
    cache.store("a", "blob:a");
    expect(cache.acquire("a")).toBe("blob:a"); // second mounted consumer
    expect(cache.refCount("a")).toBe(2);
    cache.release("a");
    cache.release("a");
    expect(cache.refCount("a")).toBe(0);
    expect(cache.get("a")).toBe("blob:a"); // stays warm after last release
  });

  it("evicts the least-recently-used UNREFERENCED entry when over capacity, revoking it", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    cache.store("a", "blob:a");
    cache.store("b", "blob:b");
    cache.store("c", "blob:c"); // over cap → evict oldest unref'd = a
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a");
    expect(cache.size).toBe(2);
  });

  it("evicts warm entries by approximate byte budget, not only entry count", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 10, maxBytes: 100, revoke });
    cache.store("a", "blob:a", { bytes: 70 });
    cache.store("b", "blob:b", { bytes: 40 });

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.bytes).toBe(40);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a");
  });

  it("keeps mounted entries even when the byte budget is exceeded", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 10, maxBytes: 100, revoke });
    cache.acquire("a");
    cache.store("a", "blob:a", { bytes: 120 });

    expect(cache.has("a")).toBe(true);
    expect(cache.bytes).toBe(120);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("never evicts a referenced (mounted) entry — evicts an unreferenced one instead", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    cache.acquire("a"); // a is mounted
    cache.store("a", "blob:a");
    cache.store("b", "blob:b"); // unref'd
    cache.store("c", "blob:c"); // over cap → a is oldest but pinned → evict b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(cache.has("c")).toBe(true);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:b");
  });

  it("peek() returns the url without changing recency (safe during render)", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    cache.store("a", "blob:a");
    cache.store("b", "blob:b");
    cache.peek("a"); // must NOT touch — a stays the LRU victim
    cache.store("c", "blob:c");
    expect(cache.has("a")).toBe(false);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a");
  });

  it("get() touches recency so the accessed entry survives eviction", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    cache.store("a", "blob:a");
    cache.store("b", "blob:b");
    cache.get("a"); // touch a → b is now LRU
    cache.store("c", "blob:c"); // evict b
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:b");
  });

  it("allows temporary over-capacity when every entry is pinned (safety over bound)", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    for (const k of ["a", "b", "c"]) {
      cache.acquire(k);
      cache.store(k, `blob:${k}`);
    }
    expect(cache.size).toBe(3); // nothing revoked — all mounted
    expect(revoke).not.toHaveBeenCalled();
  });

  it("trims temporary over-capacity as soon as pinned entries are released", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    for (const k of ["a", "b", "c"]) {
      cache.acquire(k);
      cache.store(k, `blob:${k}`);
    }

    cache.release("a");

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.size).toBe(2);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:a");
  });

  it("drops an empty (url-less) entry on final release without revoking", () => {
    const revoke = vi.fn();
    const cache = new ObjectUrlCache({ capacity: 2, revoke });
    cache.acquire("a"); // registered interest, bytes never resolved
    cache.release("a");
    expect(cache.has("a")).toBe(false);
    expect(cache.refCount("a")).toBe(0);
    expect(revoke).not.toHaveBeenCalled();
  });
});

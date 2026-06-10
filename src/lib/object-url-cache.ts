/**
 * Cross-mount object-URL cache (instant-cover-thumbnails PRD, Phase 1).
 *
 * Covers are loaded by resolving a Blob from IndexedDB and creating an object URL
 * in an effect; the URL is revoked on unmount. That means switching gallery tabs
 * (full unmount → remount) re-runs the whole async chain and flashes the
 * placeholder icon every time. This cache lets a URL **outlive** the component
 * that created it, keyed by the codename-stable `blb_…` id (+ crop signature), so
 * a re-mount returns the URL synchronously on frame 0 — no flicker.
 *
 * Lifecycle (the part worth getting right):
 *  - **Ref-count mounted consumers.** `acquire` on mount, `release` on unmount. A
 *    URL is revoked **only** when it is evicted while unreferenced — a visible
 *    `<img>` can never point at a revoked URL.
 *  - **Warm LRU.** Released (refs === 0) entries stay valid until the cache is
 *    over capacity, then the least-recently-used unreferenced one is evicted and
 *    its URL revoked. If everything is pinned we allow temporary over-capacity
 *    rather than revoke a mounted URL.
 *  - **revoke-before-replace.** A duplicate `store` for an existing key revokes
 *    the late URL and keeps the first, so concurrent creators converge on one URL
 *    and nothing leaks.
 *
 * `revoke` is injected (defaults to `URL.revokeObjectURL`) so the policy is pure
 * and exhaustively unit-testable without a DOM.
 */
interface Entry {
  /** The object URL, or null while a consumer has registered interest but the bytes haven't resolved. */
  url: string | null;
  /** Number of mounted consumers; 0 = warm/evictable. */
  refs: number;
}

export interface ObjectUrlCacheOptions {
  /** Max number of url-holding entries kept warm. Mounted entries may exceed this. */
  capacity?: number;
  /** Injected for tests; defaults to the global revoker. */
  revoke?: (url: string) => void;
}

const DEFAULT_CAPACITY = 256;

export class ObjectUrlCache {
  /** Insertion order doubles as LRU recency: touch = delete + re-set (moves to the back). */
  private readonly entries = new Map<string, Entry>();
  private readonly capacity: number;
  private readonly revoke: (url: string) => void;

  constructor(options: ObjectUrlCacheOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.revoke = options.revoke ?? ((url) => URL.revokeObjectURL(url));
  }

  /** Number of entries currently holding a url (the memory footprint we bound). */
  get size(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.url !== null) n += 1;
    return n;
  }

  has(key: string): boolean {
    return this.entries.get(key)?.url != null;
  }

  refCount(key: string): number {
    return this.entries.get(key)?.refs ?? 0;
  }

  /** Read the url without changing recency or refs — safe to call during render. */
  peek(key: string): string | undefined {
    return this.entries.get(key)?.url ?? undefined;
  }

  /** Like {@link peek} but also marks the entry recently-used. Use off the render path. */
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.url === null) return undefined;
    this.touch(key, entry);
    return entry.url;
  }

  /** A mounted consumer claims the key (refs++). Returns the url if one exists yet. */
  acquire(key: string): string | undefined {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { url: null, refs: 0 };
      this.entries.set(key, entry);
    }
    entry.refs += 1;
    this.touch(key, entry);
    return entry.url ?? undefined;
  }

  /**
   * Store a freshly-created url. If the key already holds a different url, the
   * incoming one is a duplicate → revoke it and keep the canonical url. Returns
   * the canonical url for the key.
   */
  store(key: string, url: string): string {
    const entry = this.entries.get(key);
    if (entry?.url != null) {
      if (entry.url !== url) this.revoke(url);
      this.touch(key, entry);
      return entry.url;
    }
    if (entry) {
      entry.url = url;
      this.touch(key, entry);
    } else {
      this.entries.set(key, { url, refs: 0 });
    }
    this.evictIfNeeded();
    return url;
  }

  /** A consumer releases the key (refs--). Empty entries are dropped; warm ones stay. */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs === 0 && entry.url === null) this.entries.delete(key);
  }

  /** Move a key to the most-recently-used position. */
  private touch(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** Evict least-recently-used unreferenced url-holding entries until within capacity. */
  private evictIfNeeded(): void {
    while (this.size > this.capacity) {
      let victim: string | null = null;
      for (const [key, entry] of this.entries) {
        if (entry.refs === 0 && entry.url !== null) {
          victim = key;
          break; // first match = least recently used
        }
      }
      if (victim === null) return; // everything pinned — allow temporary over-capacity
      const entry = this.entries.get(victim);
      if (entry?.url != null) this.revoke(entry.url);
      this.entries.delete(victim);
    }
  }
}

/** App-wide singleton for cover/thumbnail object URLs (see `useTrackCoverUrl`). */
export const coverUrlCache = new ObjectUrlCache();

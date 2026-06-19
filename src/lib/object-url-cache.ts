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
  /** Approximate backing Blob size. Used only for evicting warm entries. */
  bytes: number;
  /** Number of mounted consumers; 0 = warm/evictable. */
  refs: number;
}

export interface ObjectUrlCacheOptions {
  /** Max number of url-holding entries kept warm. Mounted entries may exceed this. */
  capacity?: number;
  /** Max approximate bytes kept warm. Mounted entries may exceed this. */
  maxBytes?: number;
  /** Injected for tests; defaults to the global revoker. */
  revoke?: (url: string) => void;
}

export interface ObjectUrlCacheStats {
  bytes: number;
  referencedBytes: number;
  referencedSize: number;
  size: number;
  warmBytes: number;
  warmSize: number;
}

const DEFAULT_CAPACITY = 64;
const DEFAULT_MAX_BYTES = Number.POSITIVE_INFINITY;

export class ObjectUrlCache {
  /** Insertion order doubles as LRU recency: touch = delete + re-set (moves to the back). */
  private readonly entries = new Map<string, Entry>();
  private readonly capacity: number;
  private readonly maxBytes: number;
  private readonly revoke: (url: string) => void;

  constructor(options: ObjectUrlCacheOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_MAX_BYTES);
    this.revoke = options.revoke ?? ((url) => URL.revokeObjectURL(url));
  }

  /** Number of entries currently holding a url (the memory footprint we bound). */
  get size(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.url !== null) n += 1;
    return n;
  }

  /** Approximate bytes currently held by url entries. */
  get bytes(): number {
    return this.stats().bytes;
  }

  stats(): ObjectUrlCacheStats {
    const stats: ObjectUrlCacheStats = {
      bytes: 0,
      referencedBytes: 0,
      referencedSize: 0,
      size: 0,
      warmBytes: 0,
      warmSize: 0,
    };
    for (const entry of this.entries.values()) {
      if (entry.url === null) continue;
      stats.bytes += entry.bytes;
      stats.size += 1;
      if (entry.refs > 0) {
        stats.referencedBytes += entry.bytes;
        stats.referencedSize += 1;
      } else {
        stats.warmBytes += entry.bytes;
        stats.warmSize += 1;
      }
    }
    return stats;
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
      entry = { bytes: 0, url: null, refs: 0 };
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
  store(key: string, url: string, options: { bytes?: number } = {}): string {
    const entry = this.entries.get(key);
    if (entry?.url != null) {
      if (entry.url !== url) this.revoke(url);
      this.touch(key, entry);
      return entry.url;
    }
    const bytes = Math.max(0, options.bytes ?? 0);
    if (entry) {
      entry.bytes = bytes;
      entry.url = url;
      this.touch(key, entry);
    } else {
      this.entries.set(key, { bytes, url, refs: 0 });
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
    else if (entry.refs === 0) this.evictIfNeeded();
  }

  /** Move a key to the most-recently-used position. */
  private touch(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  /** Evict least-recently-used unreferenced url-holding entries until within capacity. */
  private evictIfNeeded(): void {
    while (this.size > this.capacity || this.bytes > this.maxBytes) {
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

/** App-wide singleton for full cover object URLs (see `useTrackCoverUrl`). */
export const coverUrlCache = new ObjectUrlCache({
  capacity: 24,
  maxBytes: 6 * 1024 * 1024,
});

/**
 * Separate pool for cover IMAGE derivative URLs (thumbnails / backlights, see
 * `useCoverDerivativeUrl`). Kept apart from {@link coverUrlCache} so the many small
 * grid/row thumbnails can't evict the warm full-cover the dock is showing, and vice
 * versa. Larger capacity — thumbnails are tiny and numerous (a big library wall).
 */
export const coverDerivativeUrlCache = new ObjectUrlCache({
  capacity: 128,
  maxBytes: 8 * 1024 * 1024,
});

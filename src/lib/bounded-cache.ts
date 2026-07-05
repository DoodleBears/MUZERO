/**
 * Minimal LRU containers for module-scope caches that would otherwise grow
 * without bound over a long-running session (live-request streaming for hours —
 * memory-leak PRD 20260705 Phase 1, findings L-1~L-6).
 *
 * Kept deliberately tiny: insertion-order Map/Set recency, synchronous, no
 * timers. Not for anything needing TTL semantics — window-based expiry (the
 * live-request dedupe/cooldown maps) lives with its own domain logic.
 */

export interface BoundedMapOptions<K, V> {
  /** Hard cap on entry count; the least-recently-used entry is evicted past it. */
  maxEntries: number;
  /** Optional byte budget (with `bytesOf`) for caches holding real payloads (Blobs). */
  maxBytes?: number;
  bytesOf?: (value: V, key: K) => number;
  /** Called for every evicted/overwritten/deleted entry (revoke URLs, etc.). */
  onEvict?: (key: K, value: V) => void;
}

export interface BoundedMap<K, V> {
  /** Lookup that refreshes recency (a hit becomes the newest entry). */
  get(key: K): V | undefined;
  /** Lookup without touching recency. */
  peek(key: K): V | undefined;
  set(key: K, value: V): void;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  readonly bytes: number;
}

export function createBoundedMap<K, V>(options: BoundedMapOptions<K, V>): BoundedMap<K, V> {
  const map = new Map<K, V>();
  const bytesOf = options.bytesOf ?? (() => 0);
  let bytes = 0;

  function drop(key: K, value: V): void {
    map.delete(key);
    bytes -= bytesOf(value, key);
    options.onEvict?.(key, value);
  }

  function evictUntilWithinBudget(): void {
    const overBytes = () => options.maxBytes !== undefined && bytes > options.maxBytes;
    // `size > 1` keeps a single oversized entry usable instead of thrash-evicting it.
    while (map.size > options.maxEntries || (overBytes() && map.size > 1)) {
      const oldest = map.entries().next().value as [K, V] | undefined;
      if (!oldest) break;
      drop(oldest[0], oldest[1]);
    }
  }

  return {
    get(key) {
      if (!map.has(key)) return undefined;
      const value = map.get(key) as V;
      map.delete(key);
      map.set(key, value);
      return value;
    },
    peek(key) {
      return map.get(key);
    },
    set(key, value) {
      const existing = map.get(key);
      if (existing !== undefined || map.has(key)) drop(key, existing as V);
      map.set(key, value);
      bytes += bytesOf(value, key);
      evictUntilWithinBudget();
    },
    has(key) {
      return map.has(key);
    },
    delete(key) {
      if (!map.has(key)) return false;
      drop(key, map.get(key) as V);
      return true;
    },
    clear() {
      for (const [key, value] of map) options.onEvict?.(key, value);
      map.clear();
      bytes = 0;
    },
    get size() {
      return map.size;
    },
    get bytes() {
      return bytes;
    },
  };
}

export interface BoundedSet<T> {
  add(value: T): void;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  readonly size: number;
}

/** Insertion-order-evicting Set for "seen it" markers (decoded-cover memory). */
export function createBoundedSet<T>(maxEntries: number): BoundedSet<T> {
  const set = new Set<T>();
  return {
    add(value) {
      // Re-adding refreshes recency so hot markers survive a long session.
      set.delete(value);
      set.add(value);
      while (set.size > maxEntries) {
        const oldest = set.values().next().value as T;
        set.delete(oldest);
      }
    },
    has(value) {
      return set.has(value);
    },
    delete(value) {
      return set.delete(value);
    },
    clear() {
      set.clear();
    },
    get size() {
      return set.size;
    },
  };
}

/**
 * Dev-only registrable driver for the ⌘F global search overlay. The overlay's open
 * flag (App owns `trackSearchOpen`) and its query text (GlobalTrackSearch owns
 * `query`) are component-local React state, so the perf-control endpoint can't reach
 * them through the store/action surface it normally routes to. Under DEV the search
 * component registers this driver, and the perf-control bridge calls it to script
 * open / type / close for the search-perf scenario (PRD 20260615-global-search-index).
 * Null (no-op) in production — the registration is behind `import.meta.env.DEV`.
 */
export interface SearchDriver {
  setOpen: (open: boolean) => void;
  setQuery: (query: string) => void;
  /**
   * Apply a single-select filter by its `FilterOption.id` (e.g. "video" / "local" /
   * "online"), or `null` to clear — for the scope/media-filter E2E (a `@token` typed
   * into the box is just free text; the filter only applies when picked from the menu).
   */
  setFilter?: (filterId: string | null) => void;
  /** Snapshot the overlay's current resolved scope + per-section result counts + song kinds. */
  snapshot?: () => unknown;
}

let driver: SearchDriver | null = null;

/** Register (or clear, with null) the live overlay driver. Idempotent. */
export function registerSearchDriver(next: SearchDriver | null): void {
  driver = next;
}

/** The currently-registered driver, or null when the overlay isn't mounted. */
export function getSearchDriver(): SearchDriver | null {
  return driver;
}

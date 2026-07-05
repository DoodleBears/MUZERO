import { createBoundedSet } from "@/lib/bounded-cache";

/**
 * Session memory of cover URLs whose `<img>` has decoded at least once.
 *
 * Two consumers share it, which is why it lives in `lib` rather than inside the
 * cover component:
 *  - {@link CoverImage} marks a URL decoded on load, and a re-mounted virtualized
 *    row starts already-`loaded` for a URL in this set (no opacity re-fade).
 *  - `useCoverDerivativeUrl` reads it so a REMOTE cover that has already painted
 *    keeps showing while the list is scrolling (deferred), instead of blanking to
 *    its thumbhash — local covers get this for free via the object-URL cache, but a
 *    remote cover has no such cache, so a fresh one still defers (no fetch storm on
 *    a fast fling) while an already-seen one stays put.
 */
// Bounded so a multi-hour session over an endless stream of remote covers can't
// grow the marker set forever (memory-leak PRD 20260705 L-6); an evicted URL just
// re-fades on its next first paint.
const decodedCoverUrls = createBoundedSet<string>(2048);

/** Dev-only diagnostics (perf-control /memory/diag). */
export function decodedCoverUrlsStats(): { size: number } {
  return { size: decodedCoverUrls.size };
}

export function markCoverUrlDecoded(url: string): void {
  decodedCoverUrls.add(url);
}

export function hasCoverUrlDecoded(url: string): boolean {
  return decodedCoverUrls.has(url);
}

/** Test-only: clear the session decode memory so each test starts from a cold cache. */
export function resetDecodedCoverUrls(): void {
  decodedCoverUrls.clear();
}

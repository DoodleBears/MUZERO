import { useEffect, useState } from "react";

/**
 * Returns `value` while `active`, and the LAST value seen while active otherwise.
 *
 * Lets an always-mounted page keep its Dexie `useLiveQuery` subscription warm (no
 * remount → no subscription teardown / cover re-render jank on tab switch) while
 * SKIPPING the O(N) re-derivation it feeds whenever the page is hidden. A track
 * write still re-fires the live query, but this hands the heavy downstream memos a
 * STABLE (frozen) reference whenever the surface is inactive, so they keep their
 * cached result instead of rebuilding the whole-library artist/album/search index
 * on every edit. When the surface becomes active again the latest value flows
 * through and the memos recompute exactly once.
 *
 * `resyncWhileInactiveMs`: when set, the latch does NOT freeze hard while inactive —
 * instead it trailing-debounces, re-syncing to the latest `value` only after writes
 * go quiet for that long. Use this for a surface that must stay WARM for an instant
 * re-open (the ⌘F overlay): a burst of edits coalesces into ONE deferred rebuild
 * after editing stops, instead of one rebuild per edit (the fan-out) — while a hard
 * freeze would make the next open cold. Omit it for a hard freeze (a hidden tab that
 * can afford to rebuild on the next switch to it).
 *
 * This is the read-side mirror of the queue order/content split (PRD
 * scalable-track-list-reactivity): list-level derivations must not run on a
 * single-row write while nobody is looking at them.
 */
export function useFrozenWhileInactive<T>(
  value: T,
  active: boolean,
  resyncWhileInactiveMs?: number,
): T {
  const [latched, setLatched] = useState(value);
  useEffect(() => {
    // Keep the latch synced to the live value while active (so freezing on the next
    // active→inactive edge starts from the latest value).
    if (active) {
      if (value !== latched) setLatched(value);
      return;
    }
    // Inactive: hard freeze unless a trailing-resync delay is given. The cleanup
    // clears the pending timer on every new `value`, so the resync only lands once
    // writes have been quiet for `resyncWhileInactiveMs` (trailing debounce).
    if (resyncWhileInactiveMs == null || value === latched) return;
    const timer = setTimeout(() => setLatched(value), resyncWhileInactiveMs);
    return () => clearTimeout(timer);
  }, [active, value, latched, resyncWhileInactiveMs]);
  return active ? value : latched;
}

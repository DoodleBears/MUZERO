import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";

export interface UsePausedLiveQueryOptions {
  /**
   * When resuming with a cached value, wait before re-subscribing to IndexedDB.
   * This lets always-mounted pages paint their cached UI first during tab
   * transitions, then refresh off the critical first frame. The first active load
   * still runs immediately unless `initialDelayMs` is set.
   */
  resumeDelayMs?: number;
  /**
   * Optional delay before the first active subscription. Useful for overlays whose
   * shell/input should paint before a cold full-table query starts.
   */
  initialDelayMs?: number;
}

/**
 * Dexie liveQuery wrapper for always-mounted but currently hidden surfaces.
 *
 * While paused, the hook returns the last active value without touching IndexedDB,
 * so a background tab/overlay does not re-run full-table queries on every write.
 * When resumed, the cached value paints first and Dexie refreshes it once.
 */
export function usePausedLiveQuery<T>(
  query: () => Promise<T> | T,
  deps: readonly unknown[],
  active: boolean,
  initialValue: T,
  options: UsePausedLiveQueryOptions = {},
): T {
  const cacheRef = useRef(initialValue);
  const hasActiveValueRef = useRef(false);
  const resumeDelayMs = Math.max(0, options.resumeDelayMs ?? 0);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 0);
  const [observingActive, setObservingActive] = useState(() => active && initialDelayMs === 0);

  useEffect(() => {
    if (!active) {
      setObservingActive(false);
      return undefined;
    }
    const delayMs = hasActiveValueRef.current ? resumeDelayMs : initialDelayMs;
    if (delayMs === 0) {
      setObservingActive(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setObservingActive(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, initialDelayMs, resumeDelayMs]);

  const live = useLiveQuery(
    () => (observingActive ? query() : Promise.resolve(cacheRef.current)),
    [observingActive, ...deps],
    cacheRef.current,
  );

  useEffect(() => {
    if (!observingActive) return;
    cacheRef.current = live;
    hasActiveValueRef.current = true;
  }, [observingActive, live]);

  return active && observingActive ? live : cacheRef.current;
}

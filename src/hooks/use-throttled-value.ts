import { useEffect, useRef, useState } from "react";

/**
 * Coalesce a fast-changing value to at most one emission per `intervalMs`,
 * leading + trailing: the first change after an idle period passes through
 * immediately, a burst settles on its latest value one interval later, and a
 * continuous stream (folder import, DJ refill writing the tracks table every
 * few ms) surfaces progress every interval instead of starving the way a pure
 * trailing debounce would.
 *
 * Built for heavyweight liveQuery outputs (`listAllTracks`-class full-table
 * reads): every write re-runs the query and hands React a new array; deriving
 * indexes / worker snapshots from THIS value instead caps the O(N) recompute
 * fan-out at one per interval (memory-perf-audit PRD F-3).
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [out, setOut] = useState(value);
  // 0 = never emitted → the first change is a leading-edge emission.
  const lastEmitRef = useRef(0);

  useEffect(() => {
    if (Object.is(value, out)) return;
    const elapsed = Date.now() - lastEmitRef.current;
    if (elapsed >= intervalMs) {
      lastEmitRef.current = Date.now();
      setOut(value);
      return;
    }
    const id = setTimeout(() => {
      lastEmitRef.current = Date.now();
      setOut(value);
    }, intervalMs - elapsed);
    return () => clearTimeout(id);
  }, [value, intervalMs, out]);

  return out;
}

/** Shared coalescing interval for library-wide liveQuery consumers (PRD F-3/F-4). */
export const LIBRARY_QUERY_COALESCE_MS = 250;

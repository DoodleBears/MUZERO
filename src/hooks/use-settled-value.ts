import { useEffect, useState } from "react";

/**
 * Trailing-debounce a value: returns the latest `value` that has stayed unchanged
 * for `delayMs`. The initial value is returned immediately (no startup delay).
 *
 * Used by the Now Playing background to keep cheap things instant (the plain cover
 * `<img>` follows the raw value every switch) while gating expensive cover-derived
 * work (Pixi texture upload + effect) behind a quiet period — so a rapid next/next
 * burst never pays the heavy compute for the songs it skipped past. See PRD Phase 2.
 */
export function useSettledValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(value, settled)) return;
    const id = window.setTimeout(() => setSettled(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs, settled]);
  return settled;
}

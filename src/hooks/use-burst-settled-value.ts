import { useEffect, useRef, useState } from "react";

/**
 * Leading-edge + trailing-debounce a value, so a *rapid burst* of changes is
 * coalesced while an isolated change still applies instantly.
 *
 * - The first change after a quiet period applies immediately (leading edge), so
 *   a single deliberate next/prev is never delayed.
 * - Further changes that arrive within `quietMs` of each other are held; only the
 *   final value is applied once the burst goes quiet for `quietMs` (trailing edge).
 *
 * This differs from {@link useSettledValue} (pure trailing debounce, which delays
 * *every* change). The Now Playing foreground stage uses this so a "狂按" next/prev
 * burst doesn't reconcile + allocate the whole stage subtree for every song it
 * skips past — while a normal one-at-a-time switch stays instant. See PRD Phase 31.
 */
export function useBurstSettledValue<T>(value: T, quietMs: number): T {
  const [displayed, setDisplayed] = useState(value);
  // The value we've already accepted (via a leading or trailing apply). Compared
  // by ref so the effect doesn't need `displayed` in its deps (which would clear
  // the in-flight burst timer on the apply re-render and strand the burst).
  const appliedRef = useRef(value);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (timerRef.current === null) {
      // Not in a burst. An unchanged value is a no-op; a real change applies
      // immediately (leading edge) and opens a quiet window.
      if (Object.is(value, appliedRef.current)) return;
      appliedRef.current = value;
      setDisplayed(value);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
      }, quietMs);
      return;
    }
    // Mid-burst → hold; reset the quiet window. The latest `value` is captured by
    // this timer's closure, so when the burst finally goes quiet we land on it (a
    // burst that ends back on the applied value settles to a no-op).
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      if (!Object.is(value, appliedRef.current)) {
        appliedRef.current = value;
        setDisplayed(value);
      }
    }, quietMs);
  }, [value, quietMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  return displayed;
}

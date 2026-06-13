/**
 * Leading-edge + trailing throttle for transport switches (next / prev track).
 *
 * Holding the key repeats at the OS key-repeat rate (~30/s). Unthrottled, that
 * floods the cover/background pipeline: the per-switch decode churn AND a desync
 * race where the cover and background settle on different (intermediate) tracks
 * because switches arrive far faster than the ~180ms settle window. Capping to
 * ~5/s (a) keeps the rate below that window so cover + background stay in sync,
 * (b) is slow enough to actually SEE each cover (you ID songs by their art), and
 * (c) collapses the per-key cost. A single deliberate press still fires instantly
 * (leading edge); the trailing edge guarantees the release always lands — the last
 * press in a burst runs once the cooldown ends, so you never stop one track early.
 *
 * The clock (now / timers) is injected so it unit-tests deterministically.
 */
export interface ThrottleClock {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}

/** ~5 switches/s — below the ambient settle window so the background follows each
 *  throttled switch in sync with the cover, and slow enough to read each cover. */
export const TRANSPORT_SWITCH_MIN_INTERVAL_MS = 200;

export function createTransportThrottle(
  minIntervalMs: number,
  clock: ThrottleClock,
): (run: () => void) => void {
  let lastFiredAt = Number.NEGATIVE_INFINITY;
  let timer: number | null = null;
  let pending: (() => void) | null = null;

  return (run: () => void): void => {
    const now = clock.now();
    if (now - lastFiredAt >= minIntervalMs) {
      lastFiredAt = now;
      pending = null;
      if (timer != null) {
        clock.clearTimer(timer);
        timer = null;
      }
      run();
      return;
    }
    // Within the cooldown — defer to the trailing edge, keeping only the latest
    // intent so a burst lands exactly once (on the final press).
    pending = run;
    if (timer == null) {
      timer = clock.setTimer(
        () => {
          timer = null;
          const next = pending;
          pending = null;
          if (next) {
            lastFiredAt = clock.now();
            next();
          }
        },
        minIntervalMs - (now - lastFiredAt),
      );
    }
  };
}

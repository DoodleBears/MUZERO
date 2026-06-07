import { useEffect, useState } from "react";

/** Pointer/keyboard activity that counts as "the user is here, show the chrome". */
const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Returns true once there's been no user input for `delayMs`. Any activity
 * resets it to false. When `enabled` is false it's always false (chrome stays
 * visible). Used to fade out the header + dock for an immersive Now Playing.
 */
export function useIdle(enabled: boolean, delayMs = 3500): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: number;
    const arm = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), delayMs);
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, arm, { passive: true });
    }
    arm();
    return () => {
      window.clearTimeout(timer);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, arm);
    };
  }, [enabled, delayMs]);

  return idle;
}

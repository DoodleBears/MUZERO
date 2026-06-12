import { useEffect, useState } from "react";

const ACTIVITY_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;
const DESKTOP_HOT_ZONE_QUERY = "(min-width: 768px) and (hover: hover) and (pointer: fine)";

export const DOCK_REVEAL_HOT_ZONE_PX = 176;

/**
 * Dock-specific idle behavior. On touch/narrow screens it behaves like normal
 * chrome idle: any activity reveals the dock. On wide pointer devices, once the
 * dock has hidden, only moving the pointer into the bottom hot zone reveals it.
 */
export function useDockIdle(
  enabled: boolean,
  delayMs = 3500,
  hotZoneHeightPx = DOCK_REVEAL_HOT_ZONE_PX,
): boolean {
  const desktopHotZoneMode = useDesktopHotZoneMode();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }

    let timer: number | undefined;
    const clearTimer = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      timer = undefined;
    };
    const hideLater = () => {
      clearTimer();
      timer = window.setTimeout(() => setHidden(true), delayMs);
    };
    const isInHotZone = (clientY: number) => clientY >= window.innerHeight - hotZoneHeightPx;

    if (desktopHotZoneMode) {
      const onPointer = (event: PointerEvent) => {
        if (isInHotZone(event.clientY)) {
          clearTimer();
          setHidden(false);
          return;
        }
        hideLater();
      };

      window.addEventListener("pointermove", onPointer, { passive: true });
      window.addEventListener("pointerdown", onPointer, { passive: true });
      hideLater();
      return () => {
        clearTimer();
        window.removeEventListener("pointermove", onPointer);
        window.removeEventListener("pointerdown", onPointer);
      };
    }

    const onActivity = () => {
      setHidden(false);
      hideLater();
    };
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, { passive: true });
    }
    hideLater();
    return () => {
      clearTimer();
      for (const eventName of ACTIVITY_EVENTS) window.removeEventListener(eventName, onActivity);
    };
  }, [desktopHotZoneMode, delayMs, enabled, hotZoneHeightPx]);

  return hidden;
}

function useDesktopHotZoneMode(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(DESKTOP_HOT_ZONE_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (!window.matchMedia) return;
    const media = window.matchMedia(DESKTOP_HOT_ZONE_QUERY);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return matches;
}

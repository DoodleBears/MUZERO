import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";

type LongPressOptions = {
  /** Hold duration before the gesture fires. */
  delayMs?: number;
  /** Cancel if the pointer drifts more than this (scroll/drag, not a hold). */
  moveTolerance?: number;
};

export type LongPressHandlers = {
  onPointerDown: (e: ReactPointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onPointerMove: (e: ReactPointerEvent) => void;
};

/**
 * Press-and-hold gesture — the touch-friendly equivalent of a right-click.
 * Fires `onLongPress` once the primary pointer is held for `delayMs` without
 * drifting past `moveTolerance`. Secondary (right-click) presses are ignored so
 * they fall through to a separate `onContextMenu`.
 *
 * A long press still emits a trailing `click`; call `consumeClick()` at the top
 * of the element's `onClick` and bail when it returns true so the tap action
 * doesn't also run.
 */
export function useLongPress(
  onLongPress: () => void,
  { delayMs = 500, moveTolerance = 10 }: LongPressOptions = {},
): { handlers: LongPressHandlers; consumeClick: () => boolean } {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  // Drop a pending timer if the element unmounts mid-press.
  useEffect(() => clear, [clear]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== 0) return; // leave right-click for onContextMenu
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress();
      }, delayMs);
    },
    [delayMs, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerUp: clear,
      onPointerLeave: clear,
      onPointerCancel: clear,
      onPointerMove,
    },
    consumeClick,
  };
}

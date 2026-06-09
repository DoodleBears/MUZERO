import { useEffect, useRef } from "react";
import { hasModalDialogOpen, isTypingTarget } from "@/lib/dom-keys";
import { accumulateBackSwipe } from "@/lib/library-nav";

/** Accumulated px of left→right trackpad travel that fires "back". */
const SWIPE_BACK_THRESHOLD = 120;
/** Idle gap that ends a swipe run (so two separate flicks don't add up). */
const SWIPE_RESET_MS = 140;

/**
 * "Go back one level" gesture for a detail view: the **A / ←** key, or a macOS
 * trackpad **left→right two-finger swipe**. Wired while a detail (set / album /
 * artist) is open; the key is consumed in capture so it never doubles with the
 * player transport, and a horizontal-dominant swipe preempts the native
 * overscroll back-nav so the SPA owns the gesture. Children that scroll
 * horizontally (e.g. the artist albums strip) opt out with `data-no-swipe-back`.
 */
export function useBackGesture(onBack: () => void, enabled = true): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    let acc = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k !== "a" && k !== "arrowleft") return;
      if (isTypingTarget(e.target) || hasModalDialogOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onBackRef.current();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("[data-no-swipe-back]")) return;
      // Claim only horizontal-dominant gestures, suppressing the native back-nav.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault();
      acc = accumulateBackSwipe(acc, e.deltaX, e.deltaY);
      if (resetTimer) clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        acc = 0;
      }, SWIPE_RESET_MS);
      if (acc <= -SWIPE_BACK_THRESHOLD) {
        acc = 0;
        onBackRef.current();
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("wheel", onWheel);
      if (resetTimer) clearTimeout(resetTimer);
    };
  }, [enabled]);
}

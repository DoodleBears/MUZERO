import type { Virtualizer } from "@tanstack/react-virtual";

/** Mirrors TanStack Virtual's default `isScrolling` reset delay (ms). */
export const IS_SCROLLING_RESET_DELAY = 150;

/**
 * Drop-in replacement for TanStack Virtual's `observeElementOffset` that batches
 * native scroll events to ONE read per animation frame.
 *
 * Raw wheel/trackpad scroll fires faster than frames (120Hz trackpads), and the
 * default observer recomputes the virtual window on every event — redundant work
 * that janks a heavy list (avg ~90fps / low ~20 on the 6k-track list). Coalescing to
 * rAF — the same batching the Lenis smooth-scroll driver does, which is why turning
 * smooth scroll ON paradoxically scrolled *smoother* — recomputes at most once per
 * frame, so native scroll approaches Lenis's smoothness without owning a scroll rAF.
 *
 * `isScrolling` is preserved exactly: true on the first event of a gesture, false
 * `IS_SCROLLING_RESET_DELAY`ms after the last — so isScrolling-gated work (deferring
 * cover decode mid-scroll) still flips. The rows are absolutely positioned and scroll
 * natively with the container, so a 1-frame-later window update is covered by overscan
 * (no visible lag). The accepted `cb`/return contract matches the default observer.
 */
export function rafObserveElementOffset<TScroll extends Element, TItem extends Element>(
  instance: Virtualizer<TScroll, TItem>,
  cb: (offset: number, isScrolling: boolean) => void,
): undefined | (() => void) {
  const element = instance.scrollElement;
  if (!element) return;
  let raf = 0;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;
  const read = (isScrolling: boolean) => {
    const { horizontal, isRtl } = instance.options;
    const raw = horizontal ? element.scrollLeft * (isRtl ? -1 : 1) : element.scrollTop;
    cb(Math.max(0, raw), isScrolling);
  };
  const onScroll = () => {
    // Many wheel-rate events collapse into one read on the next frame.
    if (!raf) {
      raf = requestAnimationFrame(() => {
        raf = 0;
        read(true);
      });
    }
    // Trailing edge: settle `isScrolling` back to false once events stop.
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => read(false), IS_SCROLLING_RESET_DELAY);
  };
  read(false); // initial offset, not scrolling
  element.addEventListener("scroll", onScroll, { passive: true });
  return () => {
    element.removeEventListener("scroll", onScroll);
    if (raf) cancelAnimationFrame(raf);
    if (resetTimer) clearTimeout(resetTimer);
  };
}

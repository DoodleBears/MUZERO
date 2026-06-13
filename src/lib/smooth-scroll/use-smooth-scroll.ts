import Lenis from "lenis";
import { type RefObject, useEffect, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { isMac, isWindows } from "@/lib/shortcuts";
import { registerLenis, requestLenisTick, unregisterLenis } from "./lenis-driver";
import { resolveSmoothScroll } from "./resolve";

/**
 * Opt a scroll container into smooth scrolling. Attaches a Lenis instance to the
 * element behind `ref` (its existing `overflow-y-auto` div — no extra DOM) when
 * {@link resolveSmoothScroll} says so, and tears it down otherwise. Every active
 * instance is ticked by the shared rAF driver.
 *
 * Returns a stable `lenisRef` so callers can route programmatic scrolls
 * (scrollToIndex / reset / scrollIntoView) through Lenis — see {@link lenisScrollTo}.
 */
export function useSmoothScroll(ref: RefObject<HTMLElement | null>): {
  lenisRef: RefObject<Lenis | null>;
} {
  const settings = useSettings();
  const { enabled, options } = resolveSmoothScroll(settings, {
    isMac: isMac(),
    isWindows: isWindows(),
  });

  const lenisRef = useRef<Lenis | null>(null);
  // Latest options without retriggering the create effect (only lerp varies, and
  // it is applied in place below — recreating on every slider tick would jump scroll).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Track the live DOM node. A ref alone can't retrigger the create effect when a
  // conditionally rendered scroll container mounts (e.g. an empty→non-empty list),
  // so mirror `ref.current` into state — this effect runs after every commit and
  // re-attaches Lenis once the node appears.
  const [element, setElement] = useState<HTMLElement | null>(() => ref.current);
  // No deps: runs after every commit so it catches the node mounting/unmounting.
  useEffect(() => {
    if (ref.current !== element) setElement(ref.current);
  });

  // Create / destroy. Keyed on `enabled` + the resolved node: toggling the setting
  // flips `enabled`; the node mounting flips `element`. Strength changes do NOT
  // recreate (applied in place below).
  useEffect(() => {
    // Lenis needs a real browser layout environment (it observes size via
    // ResizeObserver). Skip in jsdom / SSR / non-DOM contexts where that's
    // absent — callers just keep native scrolling.
    if (!enabled || !element || typeof ResizeObserver === "undefined") return;
    const lenis = new Lenis({
      wrapper: element,
      // For element wrappers Lenis reads `wrapper.scrollHeight`; `content` is
      // mainly the ResizeObserver target. Using the wrapper itself covers
      // multi-child columns (Settings, Now Playing) instead of watching only the
      // first card and missing later siblings.
      content: element,
      autoRaf: false, // shared driver ticks us
      ...optionsRef.current,
    });
    lenisRef.current = lenis;
    registerLenis(lenis);

    // Re-measure on CONTENT growth. Lenis derives its scroll limit from
    // `wrapper.scrollHeight`, but its autoResize only watches the wrapper's own box —
    // which is fixed for a flex/grid column — so content that grows AFTER attach (a
    // cover image loading, lyrics / DJ console / annotation expanding, a virtual list
    // appending rows) leaves the limit stale and too-short: the column "can't scroll
    // down" past the old height. Watch the wrapper's CHILDREN (their boxes reflect the
    // content height) plus child add/remove, and re-measure. `resize()` is a cheap
    // read; the observers already batch (RO per frame, MO per microtask).
    const remeasure = () => lenis.resize();
    const contentObserver = new ResizeObserver(remeasure);
    const observeChildren = () => {
      contentObserver.disconnect();
      for (const child of element.children) contentObserver.observe(child);
    };
    observeChildren();
    const childListObserver = new MutationObserver(() => {
      observeChildren();
      remeasure();
    });
    childListObserver.observe(element, { childList: true });
    remeasure();

    return () => {
      contentObserver.disconnect();
      childListObserver.disconnect();
      unregisterLenis(lenis);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, [enabled, element]);

  // Apply strength changes in place (Lenis reads options.lerp each frame).
  useEffect(() => {
    const lerp = options.lerp;
    if (lenisRef.current && lerp !== undefined) lenisRef.current.options.lerp = lerp;
  }, [options.lerp]);

  return { lenisRef };
}

/**
 * Route a programmatic scroll through Lenis when it is active, so it doesn't
 * fight the smoothing (a raw `scrollTop =` desyncs Lenis' target and snaps back).
 * Returns `true` when handled; callers fall back to native scrolling on `false`.
 */
export function lenisScrollTo(
  lenisRef: RefObject<Lenis | null>,
  target: number | string | HTMLElement,
  opts?: { immediate?: boolean },
): boolean {
  const lenis = lenisRef.current;
  if (!lenis) return false;
  lenis.scrollTo(target, { immediate: opts?.immediate ?? true });
  requestLenisTick(lenis);
  return true;
}

/**
 * Progressive-enhancement wrapper around the native View Transitions API.
 *
 * The app ships in platform WebViews (WKWebView / WebView2 / WebKitGTK) whose
 * support for `document.startViewTransition` varies by OS version, so this
 * helper feature-detects and falls back to running the update synchronously —
 * the DOM change always happens, animated or not. Everything is gated on
 * `prefers-reduced-motion` so users who opt out of motion get instant swaps.
 *
 * Shared-element transitions (the now-playing cover ↔ full sheet) are handled by
 * `motion`'s `layoutId` instead, which is consistent across every WebView. This
 * helper is for whole-page tab → tab cross-fades only.
 */

type StartViewTransition = (callback: () => void) => unknown;

/** The bound native `startViewTransition`, or null when unsupported. */
function getStartViewTransition(): StartViewTransition | null {
  if (typeof document === "undefined") return null;
  const fn = (document as Document & { startViewTransition?: StartViewTransition })
    .startViewTransition;
  return typeof fn === "function" ? fn.bind(document) : null;
}

/** True when the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Native view transitions are usable AND the user hasn't opted out of motion. */
export function canViewTransition(): boolean {
  return getStartViewTransition() !== null && !prefersReducedMotion();
}

/**
 * Run `update` inside a native View Transition when possible; otherwise run it
 * directly. `update` is invoked exactly once either way, so callers can rely on
 * the DOM mutation happening regardless of browser support. Wrap React state
 * changes in `flushSync` at the call site so the DOM is updated before the
 * transition snapshots it.
 */
export function startViewTransition(update: () => void): void {
  const start = getStartViewTransition();
  if (start && !prefersReducedMotion()) start(update);
  else update();
}

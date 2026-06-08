/**
 * Page-transition shim.
 *
 * Native `document.startViewTransition` is intentionally disabled for now:
 * WKWebView can flicker or interrupt media when it snapshots full-screen
 * compositor layers (video, canvas visualizers, blurred backgrounds). Shared
 * element and local control animations still use Motion; tab changes run as a
 * plain synchronous state update.
 */

/** True when the user has asked the OS to reduce motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Native page view transitions are currently disabled app-wide. */
export function canViewTransition(): boolean {
  return false;
}

/**
 * Run `update` inside a native View Transition when possible; otherwise run it
 * directly. `update` is invoked exactly once either way, so callers can rely on
 * the DOM mutation happening regardless of browser support. Wrap React state
 * changes in `flushSync` at the call site so the DOM is updated before the
 * transition snapshots it.
 */
export function startViewTransition(update: () => void): void {
  update();
}

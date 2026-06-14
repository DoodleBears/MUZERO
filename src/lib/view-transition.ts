/**
 * Page-transition shim.
 *
 * Native `document.startViewTransition` is enabled only on **Chromium-class
 * engines** — Electron (the primary desktop shell), WebView2, and web Chrome /
 * Edge. **WebKit shells (WKWebView / WebKitGTK) stay disabled**: they can flicker
 * or interrupt media when snapshotting full-screen compositor layers (video,
 * canvas visualizers, blurred backgrounds). On those shells `startViewTransition`
 * falls back to a plain synchronous update, so callers behave identically minus
 * the animation. Shared-element morphs opt in by assigning a `view-transition-name`
 * to the matching elements; local control animations still use Motion.
 */

import { createDiagnosticLogger } from "@/lib/logger";

const viewTransitionLog = createDiagnosticLogger("shell.transition");

/**
 * Chromium-class engine sniff. Electron / WebView2 / Chrome / Edge carry a
 * `Chrome/`, `Chromium/`, or `Edg/` product token; WebKit shells (WKWebView,
 * WebKitGTK, Safari) and the WebKit-backed iOS Chrome (`CriOS/`) do not — so this
 * enables the Chromium desktop shells and excludes the WebKit ones.
 */
function isChromiumEngine(): boolean {
  if (typeof navigator === "undefined") return false;
  return /\b(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent);
}

/**
 * When a heavy full-screen compositor layer is live (the ambient Pixi/visualizer/
 * video backdrop), a `root` View Transition would rasterize that whole layer into
 * `::view-transition-old/new(root)` snapshots and cross-fade two copies of it for
 * the transition duration — for a layer that doesn't even change between tabs.
 * That snapshot is the tab-switch FPS dip (PRD 20260615-…-view-transition-perf,
 * Phase 2). While suppressed, `startViewTransition` runs the update synchronously
 * (same as a WebKit shell), so the swap is instant and the backdrop is untouched.
 */
let suppressed = false;

/** App shell toggles this from the ambient-backdrop-active signal. */
export function setViewTransitionSuppressed(value: boolean): void {
  suppressed = value;
}

export function isViewTransitionSuppressed(): boolean {
  return suppressed;
}

/**
 * Native page / shared-element view transitions are available — the API exists,
 * and we're on a Chromium-class engine (not a WebKit shell).
 */
export function canViewTransition(): boolean {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") {
    return false;
  }
  return isChromiumEngine();
}

/**
 * Run `update` inside a native View Transition when supported; otherwise run it
 * directly. `update` is invoked exactly once either way, so callers can rely on
 * the DOM mutation happening regardless of engine. Wrap React state changes in
 * `flushSync` at the call site so the DOM is updated before the transition
 * snapshots it (see `transitionState`).
 */
export function startViewTransition(update: () => void): void {
  const canVt = canViewTransition();
  const used = canVt && !suppressed;
  viewTransitionLog.debug("transition", {
    message: "shell view transition",
    category: "performance",
    phase: used ? "start" : "skip",
    used,
    canViewTransition: canVt,
    suppressed,
  });
  if (used) {
    document.startViewTransition(update);
    return;
  }
  update();
}

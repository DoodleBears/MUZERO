import type { Tab } from "@/components/nav/dock-nav";

/**
 * The single source of truth for switching the active app tab.
 *
 * All five tabs are kept MOUNTED (App toggles `display:none` / `visibility:hidden`
 * rather than unmounting), and the library/search tab is rendered `keepLayout` so
 * its scroll position, open set/detail, and sort survive a switch BY DESIGN. A tab
 * switch must therefore be a plain state update — it must NOT wrap `setTab` in
 * `transitionState` (`startViewTransition` + `flushSync`).
 *
 * Why: a root View Transition rasterizes the whole kept-mounted tree into
 * old/new snapshots and — besides the documented FPS cost (view-transition-perf
 * PRD, which already suppresses it while the ambient backdrop is live) — disturbs
 * the library tab's scroll/restore on the way back. That surfaced as "Ctrl+1/2
 * resets my playlist scroll/position", while the *direct* `setTab` used by the
 * dock song → Now Playing open stayed faithful. This helper makes every entry
 * point take that proven-faithful direct path so they all behave identically.
 *
 * Every tab-switch entry point routes through here: keyboard nav actions
 * (`nav.tab*`), the header nav tabs, the dock nav FAB, the dock song open, and the
 * upload/chat jumps. Do NOT call `transitionState`/`setTab` for tab navigation at
 * the call site — that re-introduces the divergence this helper removes. In-page
 * shared-element morphs (cover detail open/close in the library) still use
 * `transitionState`; those animate within a tab and are not tab navigation.
 *
 * See `docs/prd/desktop/20260621-muzero-tab-switch-state-reset-alignment-prd/`.
 */
export function navigateToTab(setTab: (tab: Tab) => void, tab: Tab): void {
  setTab(tab);
}

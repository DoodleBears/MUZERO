import type { Tab } from "@/components/nav/dock-nav";

/**
 * The single source of truth for a PLAIN tab switch (no shared-element morph).
 *
 * All five tabs are kept MOUNTED (App toggles `display:none` / `visibility:hidden`
 * rather than unmounting), and the library/search tab is rendered `keepLayout` so
 * it stays in layout while hidden. A plain `setTab` is therefore PROVABLY faithful:
 * the library tab's `scrollTop` survives (it never leaves layout) and its `sort` /
 * open set/detail are plain React state on a component that never unmounts. So a
 * plain switch cannot reset library scroll/sort — by construction.
 *
 * What this helper deliberately AVOIDS: wrapping the switch in `transitionState`
 * (`startViewTransition` + `flushSync`). Every plain nav entry point used to do
 * that, snapshotting the whole kept-mounted tree into a root View Transition. That
 * carries the documented FPS cost (view-transition-perf PRD, already suppressed
 * while the ambient backdrop is live) and was the path that surfaced as "Ctrl+1/2
 * resets my playlist scroll/sort". Routing the plain switches through here makes
 * them all behave identically and faithfully.
 *
 * Scope: keyboard nav actions (`nav.tab*`), the header nav tabs, the dock nav FAB,
 * and the upload/chat jumps. NOT in scope — and intentionally left on their own
 * `transitionState`: the dock song → Now Playing open (a shared-element COVER
 * MORPH, see track-identity-row) and the in-page library detail opens (set /
 * artist / album cover morphs in search-page). Those animate a named element into
 * a tab; they are not plain tab cross-fades. Do NOT wrap a plain tab switch in
 * `transitionState` at the call site — that re-introduces the divergence this
 * helper removes.
 *
 * See `docs/prd/desktop/20260621-muzero-tab-switch-state-reset-alignment-prd/`.
 */
export function navigateToTab(setTab: (tab: Tab) => void, tab: Tab): void {
  setTab(tab);
}

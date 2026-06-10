import type { MouseEvent as ReactMouseEvent } from "react";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { hasModalDialogOpen } from "@/lib/dom-keys";

/**
 * Controls whose press must NOT move the window — every interactive surface, so a
 * background drag only starts on genuinely empty space / static text. Track rows
 * are `[role="option"]` + `[data-muzero-track-row]`; gallery/set cards are buttons
 * tagged `[data-gallery-card]`. Tag any other custom widget with `data-no-drag` to
 * opt it out of dragging the window.
 */
const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "textarea",
  "select",
  "label",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="option"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[role="textbox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  "[data-no-drag]",
  "[data-gallery-card]",
  "[data-muzero-track-row]",
].join(",");

/**
 * Move the frameless desktop window when the user presses an empty part of a page.
 * Wire to a region's `onMouseDown`.
 *
 * Tauri only — it calls the native `startDragging` (Tauri's `data-tauri-drag-region`
 * fires only on an exact target hit, so a single delegated handler is how we make
 * *all* empty space draggable regardless of DOM shape). Electron drags via the
 * `-webkit-app-region` CSS gutters instead, and the web build has no window to move,
 * so this no-ops there.
 *
 * Self-filtering: ignores non-primary buttons, presses on any interactive control,
 * scrollbar-gutter presses (let them scroll), and any press while a modal owns the
 * screen. It never runs for portaled overlays (dialogs/menus) — those mount outside
 * the wired region, so their presses don't bubble here.
 */
export function dragWindowOnEmptyPress(e: ReactMouseEvent<HTMLElement>): void {
  if (e.button !== 0 || e.defaultPrevented) return;
  const bridge = resolveDesktopBridge();
  if (bridge.kind !== "tauri" || !bridge.startWindowDrag) return;
  const target = e.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.closest(INTERACTIVE_SELECTOR)) return;
  // A press in the scrollbar gutter (right/bottom of a scroll container) should
  // scroll, not drag the window.
  if (e.nativeEvent.offsetX > target.clientWidth || e.nativeEvent.offsetY > target.clientHeight) {
    return;
  }
  if (hasModalDialogOpen()) return;
  e.preventDefault();
  void bridge.startWindowDrag();
}

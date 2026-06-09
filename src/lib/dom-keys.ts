/**
 * Tiny DOM guards shared by the global keyboard handlers (player transport,
 * library navigation, back gesture). Kept in one place so every handler agrees on
 * "is the user typing?" and "is a modal open?" before claiming a key.
 */

/** True when the event target is a text field — don't hijack keys while typing. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** True when a modal dialog owns the screen — global shortcuts should stand down. */
export function hasModalDialogOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

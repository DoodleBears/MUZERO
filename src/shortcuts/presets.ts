/**
 * Named keymap presets (PRD Phase 5). A preset is a curated, conflict-free sparse
 * override map; applying one writes it via `setAllShortcutOverrides` (the simple
 * apply-model — no separate preset layer). Pure data so the conflict-free
 * invariant is unit-tested.
 */

import type { ScopedShortcutBinding, ShortcutGesture, ShortcutScope } from "./registry";

function key(
  code: string,
  keyLabel: string,
  mods: { shiftKey?: boolean; altKey?: boolean; primaryKey?: boolean } = {},
): ShortcutGesture {
  return { kind: "key", stroke: { code, keyLabel, ...mods } };
}

export interface ShortcutPreset {
  id: string;
  labelKey: string;
  /** Sparse override map applied (replacing the user's overrides) on choose. */
  overrides: Record<string, ScopedShortcutBinding[]>;
}

function bind(scope: ShortcutScope, gesture: ShortcutGesture): ScopedShortcutBinding {
  return { scope, gesture };
}

export const SHORTCUT_PRESETS: readonly ShortcutPreset[] = [
  {
    // Classic media-player transport on the arrow keys (the pre-Q/E scheme).
    id: "arrows",
    labelKey: "shortcuts.preset.arrows",
    overrides: {
      "playback.prev": [bind("global", key("ArrowLeft", "←"))],
      "playback.next": [bind("global", key("ArrowRight", "→"))],
      "playback.seekBack": [bind("global", key("ArrowLeft", "←", { shiftKey: true }))],
      "playback.seekForward": [bind("global", key("ArrowRight", "→", { shiftKey: true }))],
    },
  },
  {
    // Vim-style library navigation (h/j/k/l).
    id: "vim",
    labelKey: "shortcuts.preset.vim",
    overrides: {
      "library.focusPrev": [bind("library", key("KeyK", "K"))],
      "library.focusNext": [bind("library", key("KeyJ", "J"))],
      "library.open": [bind("library", key("KeyL", "L"))],
      "library.back": [bind("library", key("KeyH", "H"))],
    },
  },
];

export const SHORTCUT_PRESETS_BY_ID: Readonly<Record<string, ShortcutPreset>> = Object.fromEntries(
  SHORTCUT_PRESETS.map((preset) => [preset.id, preset]),
);

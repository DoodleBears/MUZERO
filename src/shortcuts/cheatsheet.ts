/**
 * Pure model for the "view all shortcuts" cheat-sheet: group every registry action
 * by category (configurable sections + a read-only Reference section), with its
 * live chips, and a query matcher. No React, no i18n — the component resolves
 * labels and renders; this stays unit-testable.
 */

import { freeTextMatches } from "@/lib/search-core";
import { actionBindingChips, type MergedBindings } from "./engine";
import {
  isEditableAction,
  type Platform,
  type ScopedShortcutBinding,
  SHORTCUT_ACTIONS,
  type ShortcutActionDef,
  type ShortcutCategory,
} from "./registry";

/** Section order in the cheat-sheet; `reference` (intrinsic keys) always last. */
export const CHEAT_SHEET_CATEGORY_ORDER: readonly ShortcutCategory[] = [
  "playback",
  "navigation",
  "library",
  "search",
  "memory",
  "reference",
];

export interface CheatSheetRow {
  actionId: string;
  labelKey: string;
  /** false for protected / display-only (reference) rows — no edit affordances. */
  editable: boolean;
  /** Formatted key-chord chips, one inner array per binding (its modifier+key caps). */
  chips: string[][];
  /** The key gestures behind `chips`, same order — for per-chip remove. */
  keyBindings: ScopedShortcutBinding[];
  /** i18n labelKeys for display-only pointer gestures (swipe / cover). */
  gestureLabelKeys: string[];
  keywords: readonly string[];
}

export interface CheatSheetSection {
  category: ShortcutCategory;
  rows: CheatSheetRow[];
}

function toRow(
  action: ShortcutActionDef,
  bindings: MergedBindings,
  platform: Platform,
): CheatSheetRow {
  const list = bindings[action.id] ?? [];
  return {
    actionId: action.id,
    labelKey: action.labelKey,
    editable: isEditableAction(action),
    chips: actionBindingChips(action.id, bindings, platform),
    keyBindings: list
      .filter((binding) => binding.gesture.kind === "key")
      .map((binding) => ({ scope: binding.scope, gesture: binding.gesture })),
    gestureLabelKeys: list
      .map((b) => b.gesture)
      .filter((g) => g.kind === "pointer")
      .map((g) => (g as { labelKey: string }).labelKey),
    keywords: action.keywords ?? [],
  };
}

/** Group every action into ordered sections, dropping empty categories. */
export function buildCheatSheet(bindings: MergedBindings, platform: Platform): CheatSheetSection[] {
  const byCategory = new Map<ShortcutCategory, CheatSheetRow[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const rows = byCategory.get(action.category) ?? [];
    rows.push(toRow(action, bindings, platform));
    byCategory.set(action.category, rows);
  }
  return CHEAT_SHEET_CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    rows: byCategory.get(category) ?? [],
  }));
}

/**
 * Match a row against a search query, using the already-resolved (localized)
 * action label. Transliteration-aware (Chinese pinyin / Japanese kana↔romaji) via
 * `freeTextMatches`, over the label, action id, keywords, and chord text.
 */
export function cheatSheetRowMatches(row: CheatSheetRow, query: string, label: string): boolean {
  return freeTextMatches(query, [label, row.actionId, ...row.keywords, ...row.chips.flat()]);
}

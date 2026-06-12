/**
 * Pure model for the "view all shortcuts" cheat-sheet: group every registry action
 * by surface scope (global / now / library / queue / inspector), with its
 * live chips, and a query matcher. No React, no i18n — the component resolves
 * labels and renders; this stays unit-testable.
 */

import { freeTextMatches } from "@/lib/search-core";
import { formatGesture, gestureIdentity, type MergedBindings } from "./engine";
import {
  isEditableAction,
  type Platform,
  type ScopedShortcutBinding,
  SHORTCUT_ACTIONS,
  type ShortcutActionDef,
  type ShortcutCategory,
  type ShortcutScope,
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
  scope: ShortcutScope;
  category: ShortcutCategory;
  labelKey: string;
  /** false for protected / display-only (reference) rows — no edit affordances. */
  editable: boolean;
  /** Formatted key-chord chips, one inner array per binding (its modifier+key caps). */
  chips: string[][];
  /** The key gestures behind `chips`, same order — for per-chip remove. */
  keyBindings: ScopedShortcutBinding[];
  /** Built-in key gestures for this row's `(actionId, scope)`, used by scoped reset. */
  defaultKeyBindings: ScopedShortcutBinding[];
  /** True when this row's current key bindings equal the built-in defaults. */
  isDefault: boolean;
  /** i18n labelKeys for display-only pointer gestures (swipe / cover). */
  gestureLabelKeys: string[];
  keywords: readonly string[];
}

export interface CheatSheetSection {
  scope: ShortcutScope;
  rows: CheatSheetRow[];
}

export const CHEAT_SHEET_SCOPE_ORDER: readonly ShortcutScope[] = [
  "global",
  "now",
  "library",
  "queue",
  "inspector",
];

function scopedKeyBindingsEqual(
  a: readonly ScopedShortcutBinding[],
  b: readonly ScopedShortcutBinding[],
  platform: Platform,
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (binding, index) =>
      binding.scope === b[index].scope &&
      gestureIdentity(binding.gesture, platform) === gestureIdentity(b[index].gesture, platform),
  );
}

function toRows(
  action: ShortcutActionDef,
  bindings: MergedBindings,
  platform: Platform,
): CheatSheetRow[] {
  const list = bindings[action.id] ?? [];
  const scopes = [
    ...new Set([
      ...action.defaultBindings.map((binding) => binding.scope),
      ...list.map((binding) => binding.scope),
    ]),
  ];
  return scopes.map((scope) => {
    const keyBindings = list
      .filter((binding) => binding.scope === scope && binding.gesture.kind === "key")
      .map((binding) => ({ scope: binding.scope, gesture: binding.gesture }));
    const defaultKeyBindings = action.defaultBindings.filter(
      (binding) => binding.scope === scope && binding.gesture.kind === "key",
    );
    return {
      actionId: action.id,
      scope,
      category: action.category,
      labelKey: action.labelKey,
      editable: isEditableAction(action),
      chips: keyBindings.map((binding) => formatGesture(binding.gesture, platform)),
      keyBindings,
      defaultKeyBindings,
      isDefault: scopedKeyBindingsEqual(keyBindings, defaultKeyBindings, platform),
      gestureLabelKeys: list
        .filter((binding) => binding.scope === scope)
        .map((b) => b.gesture)
        .filter((g) => g.kind === "pointer")
        .map((g) => (g as { labelKey: string }).labelKey),
      keywords: action.keywords ?? [],
    };
  });
}

/** Group every action into ordered surface sections, dropping empty scopes. */
export function buildCheatSheet(bindings: MergedBindings, platform: Platform): CheatSheetSection[] {
  const byScope = new Map<ShortcutScope, CheatSheetRow[]>();
  for (const action of SHORTCUT_ACTIONS) {
    for (const row of toRows(action, bindings, platform)) {
      const rows = byScope.get(row.scope) ?? [];
      rows.push(row);
      byScope.set(row.scope, rows);
    }
  }
  return CHEAT_SHEET_SCOPE_ORDER.filter((scope) => byScope.has(scope)).map((scope) => ({
    scope,
    rows: byScope.get(scope) ?? [],
  }));
}

/**
 * Match a row against a search query, using the already-resolved (localized)
 * action label. Transliteration-aware (Chinese pinyin / Japanese kana↔romaji) via
 * `freeTextMatches`, over the label, action id, keywords, and chord text.
 */
export function cheatSheetRowMatches(
  row: CheatSheetRow,
  query: string,
  label: string,
  scopeLabel: string = row.scope,
): boolean {
  return freeTextMatches(query, [
    label,
    scopeLabel,
    row.scope,
    row.actionId,
    ...row.keywords,
    ...row.chips.flat(),
  ]);
}

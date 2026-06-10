/**
 * Pure shortcut engine — merge, identity, conflict detection, and live dispatch
 * matching. No React, no DOM (every function takes `platform` explicitly), so the
 * load-bearing logic is exhaustively unit-tested. The impure boundary is a single
 * `currentPlatform()` helper at the bottom.
 *
 * Identity is a normalized string with a FIXED modifier order
 * (`Alt+Ctrl+Meta+Shift+code`); `primaryKey` resolves to Meta on mac / Ctrl
 * elsewhere — so the same physical chord matches across platforms.
 */

import { isMac } from "@/lib/shortcuts";
import {
  isEditableAction,
  type Platform,
  SCOPE_PRECEDENCE,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS_BY_ID,
  type ShortcutActionDef,
  type ShortcutGesture,
  type ShortcutScope,
  type ShortcutStroke,
} from "./registry";

export type { Platform } from "./registry";

/** A live binding after the override→default merge, tagged with its source. */
export interface MergedBinding {
  gesture: ShortcutGesture;
  source: "custom" | "default";
}

export type MergedBindings = Record<string, MergedBinding[]>;

/** A colliding binding found for a candidate chord (same scope, different action). */
export interface ShortcutConflict {
  actionId: string;
  gesture: ShortcutGesture;
}

// ───────────────────────────────────────────────────────────── identity ──────

/** Normalized identity for a gesture; equal strings ⇒ the same chord on `platform`. */
export function gestureIdentity(gesture: ShortcutGesture, platform: Platform): string {
  if (gesture.kind === "pointer") return `pointer:${gesture.labelKey}`;
  return `key:${strokeIdentity(gesture.stroke, platform)}`;
}

function strokeIdentity(stroke: ShortcutStroke, platform: Platform): string {
  const ctrl = stroke.ctrlKey || (stroke.primaryKey && platform !== "mac");
  const meta = stroke.metaKey || (stroke.primaryKey && platform === "mac");
  return [
    stroke.altKey ? "Alt" : "",
    ctrl ? "Ctrl" : "",
    meta ? "Meta" : "",
    stroke.shiftKey ? "Shift" : "",
    stroke.code,
  ]
    .filter(Boolean)
    .join("+");
}

/** Build a single-stroke gesture from a live keyboard event (real modifiers). */
export function gestureFromEvent(event: {
  code: string;
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): ShortcutGesture {
  return {
    kind: "key",
    stroke: {
      code: event.code,
      keyLabel: keyLabelFromEvent(event.key),
      altKey: event.altKey || undefined,
      ctrlKey: event.ctrlKey || undefined,
      metaKey: event.metaKey || undefined,
      shiftKey: event.shiftKey || undefined,
    },
  };
}

/** A modifier-only key (held while composing a chord — never a chord on its own). */
export function isModifierKey(key: string): boolean {
  return key === "Alt" || key === "Control" || key === "Meta" || key === "Shift";
}

// ───────────────────────────────────────────────────────────── merge ─────────

/**
 * Live bindings = override (when the action is editable) else the built-in
 * default. An override of `[]` means "explicitly unbound" (distinct from absent →
 * default). Protected / display-only actions ignore overrides entirely.
 */
export function mergeBindings(overrides?: Record<string, ShortcutGesture[]>): MergedBindings {
  const out: MergedBindings = {};
  for (const action of SHORTCUT_ACTIONS) {
    const custom = overrides?.[action.id];
    if (custom !== undefined && isEditableAction(action)) {
      out[action.id] = custom.map((gesture) => ({ gesture, source: "custom" }));
    } else {
      out[action.id] = action.defaultBindings.map((gesture) => ({ gesture, source: "default" }));
    }
  }
  return out;
}

/**
 * Drop unknown action ids and overrides for non-editable actions, re-normalize +
 * de-dupe each gesture list. Defends against a stored keymap written by a newer/
 * older build (forward/back-compat) or a malformed value.
 */
export function sanitizeOverrides(
  raw: unknown,
  platform: Platform,
): Record<string, ShortcutGesture[]> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ShortcutGesture[]> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const action = SHORTCUT_ACTIONS_BY_ID[id];
    if (!action || !isEditableAction(action)) continue;
    if (!Array.isArray(value)) continue;
    const gestures = value.filter(isKeyGesture);
    out[id] = dedupeGestures(gestures, platform);
  }
  return out;
}

function isKeyGesture(value: unknown): value is ShortcutGesture {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "key" &&
    typeof (value as { stroke?: { code?: unknown } }).stroke?.code === "string"
  );
}

/** Drop duplicate gestures (by platform-normalized identity), preserving order. */
export function dedupeGestures(gestures: ShortcutGesture[], platform: Platform): ShortcutGesture[] {
  const seen = new Set<string>();
  const out: ShortcutGesture[] = [];
  for (const gesture of gestures) {
    const id = gestureIdentity(gesture, platform);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(gesture);
  }
  return out;
}

// ──────────────────────────────────────────────────────── conflicts ──────────

/**
 * Bindings that collide with a candidate chord. MUZERO rule: a collision is only a
 * conflict WITHIN THE SAME scope (cross-scope same-chord is intentional shadowing,
 * e.g. `↑` = volume in global AND focus-up in library). Display-only / pointer
 * gestures never conflict.
 */
export function findConflicts(
  candidateActionId: string,
  candidateGesture: ShortcutGesture,
  bindings: MergedBindings,
  platform: Platform,
): ShortcutConflict[] {
  if (candidateGesture.kind !== "key") return [];
  const scope = SHORTCUT_ACTIONS_BY_ID[candidateActionId]?.scope;
  if (!scope) return [];
  const target = gestureIdentity(candidateGesture, platform);
  const conflicts: ShortcutConflict[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === candidateActionId || action.scope !== scope) continue;
    if (action.category === "reference") continue; // display-only intrinsic keys
    for (const binding of bindings[action.id] ?? []) {
      if (binding.gesture.kind !== "key") continue;
      if (gestureIdentity(binding.gesture, platform) === target) {
        conflicts.push({ actionId: action.id, gesture: binding.gesture });
      }
    }
  }
  return conflicts;
}

// ──────────────────────────────────────────────────────── dispatch ───────────

/**
 * Resolve a live gesture to an action id, honoring scope precedence
 * (`inspector` > `library` > `global`): the most-specific ACTIVE scope that binds
 * the chord wins. Returns null when nothing matches.
 */
export function matchAction(
  gesture: ShortcutGesture,
  activeScopes: ReadonlySet<ShortcutScope>,
  bindings: MergedBindings,
  platform: Platform,
): string | null {
  if (gesture.kind !== "key") return null;
  const target = gestureIdentity(gesture, platform);
  for (const scope of SCOPE_PRECEDENCE) {
    if (!activeScopes.has(scope)) continue;
    for (const action of SHORTCUT_ACTIONS) {
      if (action.scope !== scope || action.category === "reference") continue;
      for (const binding of bindings[action.id] ?? []) {
        if (binding.gesture.kind !== "key") continue;
        if (gestureIdentity(binding.gesture, platform) === target) return action.id;
      }
    }
  }
  return null;
}

/**
 * Does a live keyboard event match ANY of one specific action's bindings? Used by
 * scoped surfaces (library nav, back gesture, memory) that already know which
 * action a key region maps to and just need "is this the rebound chord?".
 */
export function eventMatchesAction(
  event: {
    code: string;
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  actionId: string,
  bindings: MergedBindings,
  platform: Platform,
): boolean {
  const target = gestureIdentity(gestureFromEvent(event), platform);
  return (bindings[actionId] ?? []).some(
    (binding) =>
      binding.gesture.kind === "key" && gestureIdentity(binding.gesture, platform) === target,
  );
}

// ──────────────────────────────────────────────────────── display ────────────

/** Render a gesture as ordered Kbd-chip labels. Pointer gestures return []. */
export function formatGesture(gesture: ShortcutGesture, platform: Platform): string[] {
  if (gesture.kind !== "key") return [];
  const stroke = gesture.stroke;
  const ctrl = stroke.ctrlKey || (stroke.primaryKey && platform !== "mac");
  const meta = stroke.metaKey || (stroke.primaryKey && platform === "mac");
  const parts: string[] = [];
  if (stroke.altKey) parts.push(platform === "mac" ? "⌥" : "Alt");
  if (ctrl) parts.push(platform === "mac" ? "⌃" : "Ctrl");
  if (meta) parts.push("⌘");
  if (stroke.shiftKey) parts.push(platform === "mac" ? "⇧" : "Shift");
  parts.push(prettyKeyLabel(stroke.keyLabel));
  return parts;
}

/** Live bindings for one action as chip-rows (for the cheat-sheet / tooltips). */
export function actionBindingChips(
  actionId: string,
  bindings: MergedBindings,
  platform: Platform,
): string[][] {
  return (bindings[actionId] ?? [])
    .filter((binding) => binding.gesture.kind === "key")
    .map((binding) => formatGesture(binding.gesture, platform));
}

function prettyKeyLabel(keyLabel: string): string {
  if (keyLabel === " ") return "Space";
  if (keyLabel.startsWith("Arrow")) return keyLabel.replace("Arrow", "");
  return keyLabel;
}

/** Display label from a live event's `key` (uppercases single letters). */
function keyLabelFromEvent(key: string): string {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  if (key.startsWith("Arrow")) {
    const dir = key.slice(5);
    return dir === "Up" ? "↑" : dir === "Down" ? "↓" : dir === "Left" ? "←" : "→";
  }
  return key;
}

// ───────────────────────────────────────────────────── impure boundary ───────

/** The one impure helper: read the running platform (defaults to "other" in SSR). */
export function currentPlatform(): Platform {
  return isMac() ? "mac" : "other";
}

export type { ShortcutActionDef, ShortcutGesture, ShortcutScope };
export { isEditableAction, SHORTCUT_ACTIONS, SHORTCUT_ACTIONS_BY_ID };

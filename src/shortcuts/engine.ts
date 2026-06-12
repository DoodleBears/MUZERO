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
  type ScopedShortcutBinding,
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
  scope: ShortcutScope;
  gesture: ShortcutGesture;
  source: "custom" | "default";
}

export type MergedBindings = Record<string, MergedBinding[]>;
export type ShortcutOverrides = Record<string, ScopedShortcutBinding[]>;

/** A colliding binding found for a candidate chord (same scope, different action). */
export interface ShortcutConflict {
  actionId: string;
  scope: ShortcutScope;
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
export function mergeBindings(
  overrides?: Record<string, unknown> | ShortcutOverrides,
): MergedBindings {
  const out: MergedBindings = {};
  for (const action of SHORTCUT_ACTIONS) {
    const custom = overrides?.[action.id];
    if (Array.isArray(custom) && isEditableAction(action)) {
      out[action.id] = custom
        .map((binding) => normalizeStoredBinding(binding, action.scope))
        .filter((binding): binding is ScopedShortcutBinding => binding !== null)
        .map((binding) => ({ ...binding, source: "custom" as const }));
    } else {
      out[action.id] = action.defaultBindings.map((binding) => ({
        ...binding,
        source: "default" as const,
      }));
    }
  }
  return out;
}

/**
 * Drop unknown action ids and overrides for non-editable actions, re-normalize +
 * de-dupe each gesture list. Defends against a stored keymap written by a newer/
 * older build (forward/back-compat) or a malformed value.
 */
export function sanitizeOverrides(raw: unknown, platform: Platform): ShortcutOverrides {
  if (!raw || typeof raw !== "object") return {};
  const out: ShortcutOverrides = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const action = SHORTCUT_ACTIONS_BY_ID[id];
    if (!action || !isEditableAction(action)) continue;
    if (!Array.isArray(value)) continue;
    const bindings = value
      .map((item) => normalizeStoredBinding(item, action.scope))
      .filter(
        (binding): binding is ScopedShortcutBinding => !!binding && binding.gesture.kind === "key",
      );
    out[id] = dedupeScopedBindings(bindings, platform);
  }
  return out;
}

function normalizeStoredBinding(
  value: unknown,
  fallbackScope: ShortcutScope,
): ScopedShortcutBinding | null {
  if (isScopedBinding(value)) return value;
  if (isGesture(value)) return { scope: fallbackScope, gesture: value };
  return null;
}

function isScopedBinding(value: unknown): value is ScopedShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const maybe = value as { scope?: unknown; gesture?: unknown };
  return isShortcutScope(maybe.scope) && isGesture(maybe.gesture);
}

function isShortcutScope(value: unknown): value is ShortcutScope {
  return (
    value === "global" ||
    value === "now" ||
    value === "library" ||
    value === "queue" ||
    value === "inspector"
  );
}

function isGesture(value: unknown): value is ShortcutGesture {
  return isKeyGesture(value) || isPointerGesture(value);
}

function isKeyGesture(value: unknown): value is ShortcutGesture {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "key" &&
    typeof (value as { stroke?: { code?: unknown } }).stroke?.code === "string"
  );
}

function isPointerGesture(value: unknown): value is ShortcutGesture {
  return (
    !!value &&
    typeof value === "object" &&
    (value as { kind?: unknown }).kind === "pointer" &&
    typeof (value as { labelKey?: unknown }).labelKey === "string"
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

/** Drop duplicate scoped bindings, preserving order. */
export function dedupeScopedBindings(
  bindings: ScopedShortcutBinding[],
  platform: Platform,
): ScopedShortcutBinding[] {
  const seen = new Set<string>();
  const out: ScopedShortcutBinding[] = [];
  for (const binding of bindings) {
    const id = `${binding.scope}|${gestureIdentity(binding.gesture, platform)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(binding);
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
  candidateScope: ShortcutScope,
  candidateGesture: ShortcutGesture,
  bindings: MergedBindings,
  platform: Platform,
): ShortcutConflict[] {
  if (candidateGesture.kind !== "key") return [];
  if (!SHORTCUT_ACTIONS_BY_ID[candidateActionId]) return [];
  const target = gestureIdentity(candidateGesture, platform);
  const conflicts: ShortcutConflict[] = [];
  for (const action of SHORTCUT_ACTIONS) {
    if (action.id === candidateActionId) continue;
    if (action.category === "reference") continue; // display-only intrinsic keys
    for (const binding of bindings[action.id] ?? []) {
      if (binding.scope !== candidateScope) continue;
      if (binding.gesture.kind !== "key") continue;
      if (gestureIdentity(binding.gesture, platform) === target) {
        conflicts.push({ actionId: action.id, scope: binding.scope, gesture: binding.gesture });
      }
    }
  }
  return conflicts;
}

// ──────────────────────────────────────────────────────── dispatch ───────────

/**
 * Resolve a live gesture to an action id, honoring scope precedence
 * (`inspector` > `queue` > `library` > `now` > `global`): the most-specific ACTIVE
 * scope that binds the chord wins. Returns null when nothing matches.
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
      if (action.category === "reference") continue;
      for (const binding of bindings[action.id] ?? []) {
        if (binding.scope !== scope) continue;
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
  scope?: ShortcutScope,
): boolean {
  const target = gestureIdentity(gestureFromEvent(event), platform);
  return (bindings[actionId] ?? []).some(
    (binding) =>
      (scope === undefined || binding.scope === scope) &&
      binding.gesture.kind === "key" &&
      gestureIdentity(binding.gesture, platform) === target,
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
  scope?: ShortcutScope,
): string[][] {
  return (bindings[actionId] ?? [])
    .filter((binding) => binding.gesture.kind === "key")
    .filter((binding) => scope === undefined || binding.scope === scope)
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

export type { ScopedShortcutBinding, ShortcutActionDef, ShortcutGesture, ShortcutScope };
export { isEditableAction, SHORTCUT_ACTIONS, SHORTCUT_ACTIONS_BY_ID };

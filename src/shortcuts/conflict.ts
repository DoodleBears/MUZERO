/**
 * Cyclic ("循环") conflict resolution — ClipCombo's cascading-displacement model,
 * adapted to MUZERO's same-scope conflict rule. Pure (no React, no DOM).
 *
 * Assigning an occupied chord never silently steals: it DISPLACES the chord off
 * whoever currently holds it (same scope), and the displaced action is reported so
 * the UI can prompt for a replacement — whose own collision cascades the same way.
 * Feed the user's replacement chords back as more drafts until `displaced` is
 * empty; `blocked` (a protected holder, or a non-editable target) disables Save.
 */

import { gestureIdentity } from "./engine";
import {
  isEditableAction,
  type Platform,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS_BY_ID,
  type ShortcutGesture,
} from "./registry";

/** "Give this action this chord." */
export interface AssignmentDraft {
  actionId: string;
  gesture: ShortcutGesture;
}

export interface DisplacedAction {
  actionId: string;
  /** The chord it lost (must be replaced, or the action left unbound). */
  gesture: ShortcutGesture;
}

export interface ReassignmentPlan {
  /** Resulting sparse override map (only actions that differ from their default). */
  overrides: Record<string, ShortcutGesture[]>;
  /** Actions that lost a chord to a draft and still need a replacement (the chain). */
  displaced: DisplacedAction[];
  /** Protected holders / non-editable targets that block saving the assignment. */
  blocked: DisplacedAction[];
}

/** Live gesture list per action from a sparse override map (override ?? default). */
function workingFromOverrides(
  overrides: Record<string, ShortcutGesture[]> | undefined,
): Map<string, ShortcutGesture[]> {
  const working = new Map<string, ShortcutGesture[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const custom = overrides?.[action.id];
    working.set(
      action.id,
      custom !== undefined && isEditableAction(action) ? [...custom] : [...action.defaultBindings],
    );
  }
  return working;
}

function sameIdentitySeq(a: ShortcutGesture[], b: ShortcutGesture[], platform: Platform): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) => gestureIdentity(g, platform) === gestureIdentity(b[i], platform));
}

/**
 * Apply one or more drafts, displacing same-scope holders of each new chord.
 * Returns the resulting override map plus the unresolved displacements and any
 * blocking collisions. Idempotent and order-stable.
 */
export function planReassignment(
  drafts: AssignmentDraft[],
  baseOverrides: Record<string, ShortcutGesture[]> | undefined,
  platform: Platform,
): ReassignmentPlan {
  const working = workingFromOverrides(baseOverrides);
  const draftTargetIds = new Set(drafts.map((d) => d.actionId));
  const displaced: DisplacedAction[] = [];
  const blocked: DisplacedAction[] = [];

  for (const draft of drafts) {
    if (draft.gesture.kind !== "key") continue;
    const target = SHORTCUT_ACTIONS_BY_ID[draft.actionId];
    if (!target || !isEditableAction(target)) {
      blocked.push({ actionId: draft.actionId, gesture: draft.gesture });
      continue;
    }
    const identity = gestureIdentity(draft.gesture, platform);

    // Displace the chord off every same-scope holder.
    for (const other of SHORTCUT_ACTIONS) {
      if (other.id === draft.actionId || other.scope !== target.scope) continue;
      const list = working.get(other.id);
      if (!list?.some((g) => g.kind === "key" && gestureIdentity(g, platform) === identity))
        continue;
      if (!isEditableAction(other)) {
        blocked.push({ actionId: other.id, gesture: draft.gesture });
        continue; // protected holder keeps its chord; assignment can't be saved
      }
      working.set(
        other.id,
        list.filter((g) => !(g.kind === "key" && gestureIdentity(g, platform) === identity)),
      );
      if (!draftTargetIds.has(other.id)) {
        displaced.push({ actionId: other.id, gesture: draft.gesture });
      }
    }

    // Add the chord to the target (de-duped).
    const targetList = working.get(draft.actionId) ?? [];
    if (!targetList.some((g) => g.kind === "key" && gestureIdentity(g, platform) === identity)) {
      working.set(draft.actionId, [...targetList, draft.gesture]);
    }
  }

  // Sparse override map: only actions that now differ from their default.
  const overrides: Record<string, ShortcutGesture[]> = {};
  for (const action of SHORTCUT_ACTIONS) {
    if (!isEditableAction(action)) continue;
    const list = working.get(action.id) ?? [];
    if (!sameIdentitySeq(list, action.defaultBindings, platform)) {
      overrides[action.id] = list;
    }
  }

  return { overrides, displaced, blocked };
}

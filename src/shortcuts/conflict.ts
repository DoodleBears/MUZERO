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
  type ScopedShortcutBinding,
  SHORTCUT_ACTIONS,
  SHORTCUT_ACTIONS_BY_ID,
  type ShortcutGesture,
  type ShortcutScope,
} from "./registry";

/** "Give this action this chord." */
export interface AssignmentDraft {
  actionId: string;
  scope?: ShortcutScope;
  gesture: ShortcutGesture;
}

export interface DisplacedAction {
  actionId: string;
  /** The chord it lost (must be replaced, or the action left unbound). */
  gesture: ShortcutGesture;
}

export interface ReassignmentPlan {
  /** Resulting sparse override map (only actions that differ from their default). */
  overrides: Record<string, ScopedShortcutBinding[]>;
  /** Actions that lost a chord to a draft and still need a replacement (the chain). */
  displaced: DisplacedAction[];
  /** Protected holders / non-editable targets that block saving the assignment. */
  blocked: DisplacedAction[];
}

/** Live gesture list per action from a sparse override map (override ?? default). */
function workingFromOverrides(
  overrides: Record<string, ScopedShortcutBinding[]> | undefined,
): Map<string, ScopedShortcutBinding[]> {
  const working = new Map<string, ScopedShortcutBinding[]>();
  for (const action of SHORTCUT_ACTIONS) {
    const custom = overrides?.[action.id];
    working.set(
      action.id,
      custom !== undefined && isEditableAction(action) ? [...custom] : [...action.defaultBindings],
    );
  }
  return working;
}

function sameIdentitySeq(
  a: ScopedShortcutBinding[],
  b: ScopedShortcutBinding[],
  platform: Platform,
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (binding, i) =>
      binding.scope === b[i].scope &&
      gestureIdentity(binding.gesture, platform) === gestureIdentity(b[i].gesture, platform),
  );
}

/**
 * Apply one or more drafts, displacing same-scope holders of each new chord.
 * Returns the resulting override map plus the unresolved displacements and any
 * blocking collisions. Idempotent and order-stable.
 */
export function planReassignment(
  drafts: AssignmentDraft[],
  baseOverrides: Record<string, ScopedShortcutBinding[]> | undefined,
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
    const targetScope = draft.scope ?? target.scope;
    const identity = gestureIdentity(draft.gesture, platform);

    // Displace the chord off every same-scope holder.
    for (const other of SHORTCUT_ACTIONS) {
      if (other.id === draft.actionId) continue;
      if (other.category === "reference") continue; // display-only intrinsic keys
      const list = working.get(other.id);
      if (
        !list?.some(
          (binding) =>
            binding.scope === targetScope &&
            binding.gesture.kind === "key" &&
            gestureIdentity(binding.gesture, platform) === identity,
        )
      ) {
        continue;
      }
      if (!isEditableAction(other)) {
        blocked.push({ actionId: other.id, gesture: draft.gesture });
        continue; // protected holder keeps its chord; assignment can't be saved
      }
      working.set(
        other.id,
        list.filter(
          (binding) =>
            !(
              binding.scope === targetScope &&
              binding.gesture.kind === "key" &&
              gestureIdentity(binding.gesture, platform) === identity
            ),
        ),
      );
      if (!draftTargetIds.has(other.id)) {
        displaced.push({ actionId: other.id, gesture: draft.gesture });
      }
    }

    // Add the chord to the target (de-duped).
    const targetList = working.get(draft.actionId) ?? [];
    if (
      !targetList.some(
        (binding) =>
          binding.scope === targetScope &&
          binding.gesture.kind === "key" &&
          gestureIdentity(binding.gesture, platform) === identity,
      )
    ) {
      working.set(draft.actionId, [...targetList, { scope: targetScope, gesture: draft.gesture }]);
    }
  }

  // Sparse override map: only actions that now differ from their default.
  const overrides: Record<string, ScopedShortcutBinding[]> = {};
  for (const action of SHORTCUT_ACTIONS) {
    if (!isEditableAction(action)) continue;
    const list = working.get(action.id) ?? [];
    if (!sameIdentitySeq(list, action.defaultBindings, platform)) {
      overrides[action.id] = list;
    }
  }

  return { overrides, displaced, blocked };
}

/** One slot in the cascading recorder: an action + the chord being recorded for it. */
export interface RecorderDraft {
  actionId: string;
  /** The recorded replacement (null = awaiting capture). */
  gesture: ShortcutGesture | null;
  /** The chord this action LOST (set for displacement slots; absent for the primary). */
  displacedChord?: ShortcutGesture;
}

export interface RecorderReconcile {
  /** Drafts in chain order: the primary, then each displaced action's slot. */
  drafts: RecorderDraft[];
  /** The plan over the filled drafts (overrides to save; displaced; blocked). */
  plan: ReassignmentPlan;
  /** Every slot is filled and nothing is blocked by a protected holder. */
  canSave: boolean;
}

/**
 * Reactive cascade for the recorder: given the current draft slots, activate the
 * chain rooted at the primary draft — apply the active FILLED drafts, find what
 * each newly displaces, and add a pending slot for it; repeat to a fixpoint. Slots
 * not reachable from the primary (e.g. after the user re-records an upstream chord)
 * are pruned. Filled slots are reused so the user's captures persist.
 *
 * Pure, so the cascade/prune logic is unit-tested; the recorder dialog just feeds
 * it the current slots after each capture and renders the result.
 */
export function reconcileRecorderDrafts(
  drafts: RecorderDraft[],
  baseOverrides: Record<string, ScopedShortcutBinding[]> | undefined,
  platform: Platform,
): RecorderReconcile {
  const byId = new Map(drafts.map((draft) => [draft.actionId, draft]));
  const primary = drafts.find((draft) => draft.displacedChord === undefined);

  const active = new Map<string, RecorderDraft>();
  if (primary) active.set(primary.actionId, primary);

  let plan = planReassignment([], baseOverrides, platform);
  let changed = true;
  for (let guard = 0; changed && guard < 64; guard++) {
    changed = false;
    const activeFilled = [...active.values()]
      .filter((d): d is RecorderDraft & { gesture: ShortcutGesture } => d.gesture !== null)
      .map((d) => ({ actionId: d.actionId, gesture: d.gesture }));
    plan = planReassignment(activeFilled, baseOverrides, platform);
    for (const displaced of plan.displaced) {
      if (active.has(displaced.actionId)) continue;
      const existing = byId.get(displaced.actionId);
      active.set(displaced.actionId, {
        actionId: displaced.actionId,
        gesture: existing?.gesture ?? null,
        displacedChord: displaced.gesture,
      });
      changed = true;
    }
  }

  const out = [...active.values()];
  const canSave = out.every((draft) => draft.gesture !== null) && plan.blocked.length === 0;
  return { drafts: out, plan, canSave };
}

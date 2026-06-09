import type { SetSyncIndicatorConflict } from "./r2-set-sync-indicators";

export type R2ConflictResolutionAction = "keep-local" | "use-remote" | "duplicate-both";

export interface R2ConflictResolutionChoice {
  action: R2ConflictResolutionAction;
  requiresUserChoice: true;
}

export interface R2ConflictResolutionPlan {
  action: R2ConflictResolutionAction;
  entityType: SetSyncIndicatorConflict["entityType"];
  entityId: string;
  field?: string;
  applyRemote: boolean;
  duplicateLocal: boolean;
  preserveLocalMutationIds: string[];
  discardLocalMutationIds: string[];
}

const EXPLICIT_RESOLUTION_CHOICES: R2ConflictResolutionChoice[] = [
  { action: "keep-local", requiresUserChoice: true },
  { action: "use-remote", requiresUserChoice: true },
  { action: "duplicate-both", requiresUserChoice: true },
];

export function buildConflictResolutionChoices(
  _conflict: SetSyncIndicatorConflict,
): R2ConflictResolutionChoice[] {
  return EXPLICIT_RESOLUTION_CHOICES;
}

export function resolveUserAuthoredConflict(
  conflict: SetSyncIndicatorConflict,
  action?: R2ConflictResolutionAction,
): R2ConflictResolutionPlan {
  if (!action) throw new Error("User-authored conflicts require an explicit resolution action.");

  return {
    action,
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    field: conflict.field,
    applyRemote: action !== "keep-local",
    duplicateLocal: action === "duplicate-both",
    preserveLocalMutationIds: action === "use-remote" ? [] : conflict.mutationIds,
    discardLocalMutationIds: action === "use-remote" ? conflict.mutationIds : [],
  };
}

import type { R2ExportConflict } from "./r2-export-plan";
import type { RemoteSetConflict, RemoteSetDiff } from "./r2-pull-diff";

export type SetSyncIndicatorFlag =
  | "local-changes"
  | "remote-changed"
  | "auto-merged"
  | "needs-review";

export interface SetSyncIndicatorConflict {
  entityType: RemoteSetConflict["entityType"];
  entityId: string;
  field?: string;
  reason: RemoteSetConflict["reason"] | R2ExportConflict["reason"];
  mutationIds: string[];
}

export interface SetSyncIndicatorInput {
  setId: string;
  pull?: Pick<RemoteSetDiff, "action" | "reasons" | "conflict" | "reason">;
  unsyncedMutationCount?: number;
  appliedMutationCount?: number;
  exportConflicts?: R2ExportConflict[];
}

export interface SetSyncIndicator {
  setId: string;
  localChanges: boolean;
  remoteChanged: boolean;
  autoMerged: boolean;
  needsReview: boolean;
  flags: SetSyncIndicatorFlag[];
  conflicts: SetSyncIndicatorConflict[];
}

export function buildSetSyncIndicator(input: SetSyncIndicatorInput): SetSyncIndicator {
  const conflicts = indicatorConflicts(input);
  const localChanges =
    (input.unsyncedMutationCount ?? 0) > 0 ||
    input.pull?.action === "keep-local" ||
    conflicts.length > 0;
  const remoteChanged =
    input.pull?.action === "apply-remote" ||
    input.pull?.action === "create-set" ||
    input.pull?.action === "conflict" ||
    input.pull?.action === "blocked";
  const autoMerged = (input.appliedMutationCount ?? 0) > 0;
  const needsReview = conflicts.length > 0 || input.pull?.action === "blocked";

  const flags: SetSyncIndicatorFlag[] = [];
  if (localChanges) flags.push("local-changes");
  if (remoteChanged) flags.push("remote-changed");
  if (autoMerged) flags.push("auto-merged");
  if (needsReview) flags.push("needs-review");

  return {
    setId: input.setId,
    localChanges,
    remoteChanged,
    autoMerged,
    needsReview,
    flags,
    conflicts,
  };
}

function indicatorConflicts(input: SetSyncIndicatorInput): SetSyncIndicatorConflict[] {
  const conflicts: SetSyncIndicatorConflict[] = [];
  if (input.pull?.conflict) {
    conflicts.push({
      entityType: input.pull.conflict.entityType,
      entityId: input.pull.conflict.entityId,
      reason: input.pull.conflict.reason,
      mutationIds: input.pull.conflict.localMutationIds,
    });
  }

  for (const conflict of input.exportConflicts ?? []) {
    if (conflict.setId !== input.setId) continue;
    conflicts.push({
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      field: conflict.field,
      reason: conflict.reason,
      mutationIds: conflict.mutationIds,
    });
  }

  return conflicts;
}

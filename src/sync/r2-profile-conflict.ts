import type { DevicePublicProfile, DeviceRecord } from "@/db/types";

export type DeviceProfileMergeAction = "use-remote" | "keep-local" | "needs-review" | "unchanged";

export interface DeviceProfileMergeDecision {
  action: DeviceProfileMergeAction;
  reason:
    | "remote-revision-newer"
    | "local-revision-newer"
    | "same-revision-different-profile"
    | "same-revision-same-profile";
  conflicts: Array<"displayName" | "avatarSeed" | "avatar">;
}

export function decideDeviceProfileMerge(
  local: DeviceRecord,
  remote: DevicePublicProfile,
): DeviceProfileMergeDecision {
  if (remote.revision > local.profileRevision) {
    return { action: "use-remote", reason: "remote-revision-newer", conflicts: [] };
  }
  if (local.profileRevision > remote.revision) {
    return { action: "keep-local", reason: "local-revision-newer", conflicts: [] };
  }

  const conflicts = profileConflicts(local, remote);
  if (conflicts.length > 0) {
    return {
      action: "needs-review",
      reason: "same-revision-different-profile",
      conflicts,
    };
  }

  return { action: "unchanged", reason: "same-revision-same-profile", conflicts: [] };
}

function profileConflicts(
  local: DeviceRecord,
  remote: DevicePublicProfile,
): DeviceProfileMergeDecision["conflicts"] {
  const conflicts: DeviceProfileMergeDecision["conflicts"] = [];
  if (local.name !== remote.displayName) conflicts.push("displayName");
  if ((local.avatarSeed ?? "") !== (remote.avatarSeed ?? "")) conflicts.push("avatarSeed");
  if (Boolean(local.avatarBlobId) !== Boolean(remote.avatar)) conflicts.push("avatar");
  return conflicts;
}

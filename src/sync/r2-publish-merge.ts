import type {
  R2DevicesIndex,
  R2PresenceIndex,
  R2SetSummary,
  R2StatsIndex,
} from "./r2-manifest-schema";

/**
 * Pure merge rules for the multi-writer read-merge-write publish (PRD §3.11):
 * a publishing device fetches the current remote manifest/indexes, merges its
 * own entries in, and writes the union back — so two devices writing the same
 * drive stop erasing each other. Per-device discovery entries merge by device
 * id with last-write-wins on the entry clock; manifest sets merge by set id
 * with each set owned by the device that published it.
 */

export function mergeDevicesIndex(
  remote: R2DevicesIndex | undefined,
  local: R2DevicesIndex,
): R2DevicesIndex {
  if (!remote) return local;
  const merged = new Map(remote.devices.map((entry) => [entry.publicId, entry]));
  for (const mine of local.devices) {
    const theirs = merged.get(mine.publicId);
    merged.set(
      mine.publicId,
      !theirs || deviceEntryClock(mine) >= deviceEntryClock(theirs) ? mine : theirs,
    );
  }
  return {
    schema: "muzero-r2-devices-v1",
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
    devices: [...merged.values()],
  };
}

function deviceEntryClock(entry: R2DevicesIndex["devices"][number]): number {
  return entry.lastSeenAt ?? entry.profileUpdatedAt ?? 0;
}

export function mergeStatsIndex(
  remote: R2StatsIndex | undefined,
  local: R2StatsIndex,
): R2StatsIndex {
  if (!remote) return local;
  const merged = new Map(remote.devices.map((entry) => [entry.devicePublicId, entry]));
  for (const mine of local.devices) {
    const theirs = merged.get(mine.devicePublicId);
    merged.set(mine.devicePublicId, !theirs || mine.updatedAt >= theirs.updatedAt ? mine : theirs);
  }
  return {
    schema: "muzero-r2-stats-index-v1",
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
    devices: [...merged.values()],
  };
}

export function mergePresenceIndex(
  remote: R2PresenceIndex | undefined,
  local: R2PresenceIndex,
): R2PresenceIndex {
  if (!remote) return local;
  const merged = new Map(remote.devices.map((entry) => [entry.devicePublicId, entry]));
  for (const mine of local.devices) {
    const theirs = merged.get(mine.devicePublicId);
    merged.set(mine.devicePublicId, !theirs || mine.updatedAt >= theirs.updatedAt ? mine : theirs);
  }
  return {
    schema: "muzero-r2-presence-index-v1",
    updatedAt: Math.max(remote.updatedAt, local.updatedAt),
    devices: [...merged.values()],
  };
}

/**
 * Union of the remote manifest's sets with this device's exported sets:
 * - a remote set whose id this device is exporting is replaced by the local
 *   entry (the publisher is authoritative for its own sets);
 * - a remote set published by ANOTHER device — or by nobody we can attribute
 *   (legacy, or unknown self id) — is preserved verbatim;
 * - a remote set published by THIS device but absent locally was deleted here,
 *   so it drops from the manifest (objects remain; no remote deletes in v1).
 */
export function mergeManifestSets(
  remoteSets: readonly R2SetSummary[],
  localSets: readonly R2SetSummary[],
  selfDeviceId: string | undefined,
): R2SetSummary[] {
  const localIds = new Set(localSets.map((set) => set.id));
  const preserved = remoteSets.filter(
    (set) =>
      !localIds.has(set.id) &&
      (selfDeviceId == null || set.publishedBy == null || set.publishedBy !== selfDeviceId),
  );
  return [...preserved, ...localSets];
}

import type {
  R2DevicesIndex,
  R2PresenceIndex,
  R2SetIndex,
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

export interface MergeSetIndexOptions {
  /** The local session's removal tombstones, mapped to PUBLISHED track ids. */
  localRemovedTracks?: Array<{ id: string; removedAt: number }>;
}

const SET_TOMBSTONE_CAP = 200;

/**
 * Co-editing merge for one set index (PRD §12.5): adds union by track id with
 * the local entry winning a shared id; set metadata LWW on `set.updatedAt`;
 * removal tombstones union (local ∪ remote) and delete matching entries —
 * EXCEPT an id the local side re-added (present locally without a local
 * tombstone), which revokes the remote tombstone. Revision bumps past the
 * remote's so readers can observe progression.
 */
export function mergeSetIndex(
  remote: R2SetIndex | undefined,
  local: R2SetIndex,
  options: MergeSetIndexOptions = {},
): R2SetIndex {
  const localTombstones = new Map(
    (options.localRemovedTracks ?? []).map((entry) => [entry.id, entry.removedAt]),
  );
  const tombstones = new Map(localTombstones);
  for (const entry of remote?.removedTracks ?? []) {
    const existing = tombstones.get(entry.id);
    if (existing == null || entry.removedAt > existing) tombstones.set(entry.id, entry.removedAt);
  }

  const localById = new Map(local.tracks.map((track) => [track.id, track]));
  // Re-add intent: locally present without a local tombstone revokes the
  // remote tombstone (the pull-merge already applied genuine remote removals
  // to the session before this merge runs).
  for (const id of localById.keys()) {
    if (!localTombstones.has(id)) tombstones.delete(id);
  }

  const merged: R2SetIndex["tracks"] = [];
  for (const track of remote?.tracks ?? []) {
    merged.push(localById.get(track.id) ?? track);
    localById.delete(track.id);
  }
  merged.push(...localById.values());
  const tracks = merged.filter((track) => !tombstones.has(track.id));

  const removedTracks = [...tombstones.entries()]
    .map(([id, removedAt]) => ({ id, removedAt }))
    .sort((a, b) => b.removedAt - a.removedAt)
    .slice(0, SET_TOMBSTONE_CAP);

  const remoteSetNewer = remote != null && remote.set.updatedAt > local.set.updatedAt;
  return {
    schema: "muzero-r2-set-index-v1",
    revision: Math.max(remote?.revision ?? 0, local.revision ?? 0) + 1,
    set: remoteSetNewer ? remote.set : local.set,
    tracks,
    ...(removedTracks.length > 0 ? { removedTracks } : {}),
  };
}

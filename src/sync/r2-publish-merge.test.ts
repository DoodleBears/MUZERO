import { describe, expect, it } from "vitest";
import type {
  R2DevicesIndex,
  R2PresenceIndex,
  R2SetIndex,
  R2SetSummary,
  R2StatsIndex,
} from "./r2-manifest-schema";
import {
  mergeDevicesIndex,
  mergeManifestSets,
  mergePresenceIndex,
  mergeSetIndex,
  mergeStatsIndex,
} from "./r2-publish-merge";

const remoteDevices: R2DevicesIndex = {
  schema: "muzero-r2-devices-v1",
  updatedAt: 1000,
  devices: [
    {
      publicId: "dvc_a",
      displayName: "Studio laptop",
      avatarSeed: "blue",
      profile: "profiles/devices/dvc_a/profile.json",
      stats: "stats/devices/dvc_a/aggregate.json",
      lastSeenAt: 1000,
      profileUpdatedAt: 1000,
    },
  ],
};

const localDevices: R2DevicesIndex = {
  schema: "muzero-r2-devices-v1",
  updatedAt: 2000,
  devices: [
    {
      publicId: "dvc_b",
      displayName: "Bedroom desktop",
      avatarSeed: "green",
      profile: "profiles/devices/dvc_b/profile.json",
      stats: "stats/devices/dvc_b/aggregate.json",
      lastSeenAt: 2000,
      profileUpdatedAt: 2000,
    },
  ],
};

describe("mergeDevicesIndex", () => {
  it("returns the local index when there is no remote one (first publish)", () => {
    expect(mergeDevicesIndex(undefined, localDevices)).toEqual(localDevices);
  });

  it("preserves the other device's entry and upserts its own", () => {
    const merged = mergeDevicesIndex(remoteDevices, localDevices);
    expect(merged.devices.map((d) => d.publicId).sort()).toEqual(["dvc_a", "dvc_b"]);
    expect(merged.updatedAt).toBe(2000);
    expect(merged.devices.find((d) => d.publicId === "dvc_a")?.displayName).toBe("Studio laptop");
  });

  it("replaces its own stale remote entry (LWW by lastSeenAt)", () => {
    const staleSelf: R2DevicesIndex = {
      ...remoteDevices,
      devices: [
        ...remoteDevices.devices,
        { publicId: "dvc_b", displayName: "Old name", lastSeenAt: 500 },
      ],
    };
    const merged = mergeDevicesIndex(staleSelf, localDevices);
    expect(merged.devices.find((d) => d.publicId === "dvc_b")?.displayName).toBe("Bedroom desktop");
    expect(merged.devices).toHaveLength(2);
  });

  it("keeps a NEWER remote entry over a stale local one", () => {
    const newerRemote: R2DevicesIndex = {
      schema: "muzero-r2-devices-v1",
      updatedAt: 9000,
      devices: [{ publicId: "dvc_b", displayName: "Renamed elsewhere", lastSeenAt: 9000 }],
    };
    const merged = mergeDevicesIndex(newerRemote, localDevices);
    expect(merged.devices.find((d) => d.publicId === "dvc_b")?.displayName).toBe(
      "Renamed elsewhere",
    );
  });
});

describe("mergeStatsIndex", () => {
  const remote: R2StatsIndex = {
    schema: "muzero-r2-stats-index-v1",
    updatedAt: 1000,
    devices: [
      { devicePublicId: "dvc_a", aggregate: "stats/devices/dvc_a/aggregate.json", updatedAt: 1000 },
    ],
  };
  const local: R2StatsIndex = {
    schema: "muzero-r2-stats-index-v1",
    updatedAt: 2000,
    devices: [
      { devicePublicId: "dvc_b", aggregate: "stats/devices/dvc_b/aggregate.json", updatedAt: 2000 },
    ],
  };

  it("unions per-device stats entries with LWW on updatedAt", () => {
    const merged = mergeStatsIndex(remote, local);
    expect(merged.devices.map((d) => d.devicePublicId).sort()).toEqual(["dvc_a", "dvc_b"]);
    expect(merged.updatedAt).toBe(2000);
    expect(mergeStatsIndex(undefined, local)).toEqual(local);
  });
});

describe("mergePresenceIndex", () => {
  const remote: R2PresenceIndex = {
    schema: "muzero-r2-presence-index-v1",
    updatedAt: 1000,
    devices: [
      { devicePublicId: "dvc_a", presence: "presence/devices/dvc_a.json", updatedAt: 1000 },
    ],
  };
  const local: R2PresenceIndex = {
    schema: "muzero-r2-presence-index-v1",
    updatedAt: 2000,
    devices: [
      { devicePublicId: "dvc_b", presence: "presence/devices/dvc_b.json", updatedAt: 2000 },
    ],
  };

  it("unions per-device presence entries", () => {
    const merged = mergePresenceIndex(remote, local);
    expect(merged.devices.map((d) => d.devicePublicId).sort()).toEqual(["dvc_a", "dvc_b"]);
    expect(mergePresenceIndex(undefined, local)).toEqual(local);
  });
});

describe("mergeManifestSets", () => {
  const theirSet: R2SetSummary = {
    id: "ses_theirs",
    title: "Their set",
    index: "sets/ses_theirs/index.json",
    updatedAt: "2026-06-10T00:00:00.000Z",
    trackCount: 3,
    bytes: 300,
    publishedBy: "dvc_a",
  };
  const legacySet: R2SetSummary = {
    id: "ses_legacy",
    title: "Legacy set (no publisher)",
    index: "sets/ses_legacy/index.json",
    updatedAt: "2026-06-09T00:00:00.000Z",
    trackCount: 1,
    bytes: 100,
  };
  const mineRemoteStale: R2SetSummary = {
    id: "ses_mine",
    title: "Mine (stale remote copy)",
    index: "sets/ses_mine/index.json",
    updatedAt: "2026-06-09T00:00:00.000Z",
    trackCount: 1,
    bytes: 50,
    publishedBy: "dvc_b",
  };
  const mineDeleted: R2SetSummary = {
    id: "ses_mine_deleted",
    title: "Mine (deleted locally)",
    index: "sets/ses_mine_deleted/index.json",
    updatedAt: "2026-06-09T00:00:00.000Z",
    trackCount: 2,
    bytes: 80,
    publishedBy: "dvc_b",
  };
  const mineLocal: R2SetSummary = {
    id: "ses_mine",
    title: "Mine (fresh)",
    index: "sets/ses_mine/index.json",
    updatedAt: "2026-06-11T00:00:00.000Z",
    trackCount: 2,
    bytes: 120,
    publishedBy: "dvc_b",
  };

  it("preserves other devices' and legacy sets, replaces its own, drops its own deletions", () => {
    const merged = mergeManifestSets(
      [theirSet, legacySet, mineRemoteStale, mineDeleted],
      [mineLocal],
      "dvc_b",
    );
    expect(merged.map((set) => set.id)).toEqual(["ses_theirs", "ses_legacy", "ses_mine"]);
    expect(merged.find((set) => set.id === "ses_mine")?.title).toBe("Mine (fresh)");
    // The other device's entry is preserved verbatim, publishedBy included.
    expect(merged.find((set) => set.id === "ses_theirs")).toEqual(theirSet);
  });

  it("without a self device id, preserves all remote-only sets (cannot attribute deletions)", () => {
    const merged = mergeManifestSets([theirSet, mineDeleted], [mineLocal], undefined);
    expect(merged.map((set) => set.id)).toEqual(["ses_theirs", "ses_mine_deleted", "ses_mine"]);
  });

  it("returns local sets as-is when the remote manifest is empty", () => {
    expect(mergeManifestSets([], [mineLocal], "dvc_b")).toEqual([mineLocal]);
  });
});

describe("mergeSetIndex (co-editing, PRD §12.5)", () => {
  function makeTrack(id: string, title = id): R2SetIndex["tracks"][number] {
    return {
      id,
      title,
      kind: "audio",
      origin: "uploaded",
      provider: "upload",
      durationSec: 10,
      createdAt: 1,
      liked: false,
      tags: [],
      media: { url: `objects/media/${id}.mp3`, mime: "audio/mpeg", bytes: 3 },
      memories: [],
    };
  }
  function makeIndex(over: Partial<R2SetIndex> = {}): R2SetIndex {
    return {
      schema: "muzero-r2-set-index-v1",
      revision: 1,
      set: {
        id: "ses_s",
        name: "Shared",
        seedPrompt: "",
        displayMode: "cover",
        config: {
          autoExtend: false,
          refillThreshold: 2,
          batchSize: 1,
          targetDurationSec: 60,
          allowVocals: true,
        },
        createdAt: 100,
        updatedAt: 1000,
      },
      tracks: [],
      ...over,
    };
  }

  it("returns the local index (tombstones applied) when there is no remote one", () => {
    const local = makeIndex({ tracks: [makeTrack("t1"), makeTrack("t2")] });
    const merged = mergeSetIndex(undefined, local, {
      localRemovedTracks: [{ id: "t2", removedAt: 2000 }],
    });
    expect(merged.tracks.map((t) => t.id)).toEqual(["t1"]);
    expect(merged.removedTracks).toEqual([{ id: "t2", removedAt: 2000 }]);
  });

  it("unions adds from both devices, local entry winning for a shared id", () => {
    const remote = makeIndex({
      tracks: [makeTrack("shared", "Old title"), makeTrack("theirs")],
    });
    const local = makeIndex({
      set: { ...makeIndex().set, updatedAt: 2000 },
      tracks: [makeTrack("shared", "New title"), makeTrack("mine")],
    });
    const merged = mergeSetIndex(remote, local);
    expect(merged.tracks.map((t) => t.id)).toEqual(["shared", "theirs", "mine"]);
    expect(merged.tracks[0]?.title).toBe("New title");
  });

  it("set metadata is last-write-wins on updatedAt", () => {
    const remote = makeIndex({
      set: { ...makeIndex().set, name: "Renamed remotely", updatedAt: 3000 },
    });
    const local = makeIndex({ set: { ...makeIndex().set, name: "Local name", updatedAt: 1000 } });
    expect(mergeSetIndex(remote, local).set.name).toBe("Renamed remotely");
    const localNewer = makeIndex({
      set: { ...makeIndex().set, name: "Local newer", updatedAt: 4000 },
    });
    expect(mergeSetIndex(remote, localNewer).set.name).toBe("Local newer");
  });

  it("a remote tombstone removes the local stale copy and persists", () => {
    const remote = makeIndex({
      tracks: [makeTrack("keep")],
      removedTracks: [{ id: "gone", removedAt: 5000 }],
    });
    // Local is stale: it still carries "gone" — but it did NOT re-add it (the
    // pull-merge removed it before this publish merge runs; if the user truly
    // re-added it after, the local session would have cleared its own record
    // and re-added the membership, which the re-add exception below covers).
    const local = makeIndex({ tracks: [makeTrack("mine")] });
    const merged = mergeSetIndex(remote, local);
    expect(merged.tracks.map((t) => t.id)).toEqual(["keep", "mine"]);
    expect(merged.removedTracks).toEqual([{ id: "gone", removedAt: 5000 }]);
  });

  it("a local tombstone removes the remote entry", () => {
    const remote = makeIndex({ tracks: [makeTrack("theirs"), makeTrack("victim")] });
    const local = makeIndex({ tracks: [] });
    const merged = mergeSetIndex(remote, local, {
      localRemovedTracks: [{ id: "victim", removedAt: 6000 }],
    });
    expect(merged.tracks.map((t) => t.id)).toEqual(["theirs"]);
    expect(merged.removedTracks).toEqual([{ id: "victim", removedAt: 6000 }]);
  });

  it("a local re-add (present locally, no local tombstone) revokes the remote tombstone", () => {
    const remote = makeIndex({ removedTracks: [{ id: "back", removedAt: 5000 }] });
    const local = makeIndex({ tracks: [makeTrack("back")] });
    const merged = mergeSetIndex(remote, local);
    expect(merged.tracks.map((t) => t.id)).toEqual(["back"]);
    expect(merged.removedTracks).toBeUndefined();
  });

  it("bumps the revision past the remote one", () => {
    const remote = makeIndex({ revision: 7 });
    expect(mergeSetIndex(remote, makeIndex({ revision: 2 })).revision).toBe(8);
  });
});

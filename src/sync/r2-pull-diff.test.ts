import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, SyncObject } from "@/db/types";
import { diffRemoteSet } from "./r2-pull-diff";
import type { RemoteSetIndexResult } from "./r2-subscription";
import { recordSyncMutation } from "./sync-mutation-repo";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-pull-diff-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("diffRemoteSet", () => {
  it("plans a create when the remote set is not local yet", async () => {
    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet() }, db),
    ).resolves.toMatchObject({
      action: "create-set",
      remoteSetId: "ses_tokyo",
    });
  });

  it("recognizes an unchanged imported remote set", async () => {
    await db.sessions.put(localSession({ updatedAt: 1000 }));

    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 1000 }) }, db),
    ).resolves.toMatchObject({
      action: "unchanged",
    });
  });

  it("plans a remote update when there are no local unsynced mutations", async () => {
    await db.sessions.put(localSession({ updatedAt: 1000 }));

    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) }, db),
    ).resolves.toMatchObject({
      action: "apply-remote",
      reasons: ["remote-updated"],
    });
  });

  it("surfaces a conflict when local mutations and remote updates touch the same set", async () => {
    await db.sessions.put(localSession({ updatedAt: 1500 }));
    await recordSyncMutation(
      {
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_tokyo",
        action: "set-metadata-updated",
        base: { remoteKey: "sets/ses_tokyo/index.json", updatedAt: 1000 },
        payload: { name: "Local Rename" },
        now: 1600,
      },
      db,
    );

    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) }, db),
    ).resolves.toMatchObject({
      action: "conflict",
      conflict: {
        entityType: "set",
        entityId: "ses_tokyo",
        reason: "local-and-remote-changed",
      },
    });
  });

  it("surfaces a track conflict when local track metadata and the remote set changed", async () => {
    await db.sessions.put(localSession({ updatedAt: 1500 }));
    await recordSyncMutation(
      {
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "track",
        entityId: "trk_remote_drv_1_trk_blue",
        action: "track-metadata-updated",
        base: { remoteKey: "sets/ses_tokyo/index.json", updatedAt: 1000 },
        payload: { title: "Local Blue" },
        now: 1600,
      },
      db,
    );

    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) }, db),
    ).resolves.toMatchObject({
      action: "conflict",
      conflict: {
        entityType: "track",
        entityId: "trk_blue",
        reason: "local-and-remote-changed",
      },
    });
  });

  it("surfaces a memory conflict when local memory text and the remote set changed", async () => {
    await db.sessions.put(localSession({ updatedAt: 1500 }));
    await recordSyncMutation(
      {
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "memory",
        entityId: "mem_remote_drv_1_mem_blue_note",
        action: "memory-updated",
        base: { remoteKey: "sets/ses_tokyo/index.json", updatedAt: 1000 },
        payload: { note: "Local note" },
        now: 1600,
      },
      db,
    );

    await expect(
      diffRemoteSet({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) }, db),
    ).resolves.toMatchObject({
      action: "conflict",
      conflict: {
        entityType: "memory",
        entityId: "mem_blue_note",
        reason: "local-and-remote-changed",
      },
    });
  });

  it("blocks pull when a known remote object hash changes unexpectedly", async () => {
    await db.sessions.put(localSession({ updatedAt: 1000 }));
    await db.syncObjects.put(syncObject("sets/ses_tokyo/index.json", "old-sha"));

    await expect(
      diffRemoteSet(
        {
          driveId: "drv_1",
          remoteSet: remoteSet({ updatedAt: 2000 }),
          remoteIndexSha256: "new-sha",
        },
        db,
      ),
    ).resolves.toMatchObject({
      action: "blocked",
      reason: "hash-mismatch",
    });
  });
});

function localSession(input: { updatedAt: number }): DjSession {
  return {
    id: "ses_remote_drv_1_ses_tokyo",
    name: "Tokyo",
    seedPrompt: "",
    trackIds: ["trk_remote_drv_1_trk_blue"],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "cover",
    createdAt: 1000,
    updatedAt: input.updatedAt,
  };
}

function remoteSet(input: { updatedAt?: number } = {}): RemoteSetIndexResult {
  const updatedAt = input.updatedAt ?? 1000;
  return {
    indexUrl: "https://music.example.com/muzero/sets/ses_tokyo/index.json",
    index: {
      schema: "muzero-r2-set-index-v1",
      revision: 1,
      set: {
        id: "ses_tokyo",
        name: "Tokyo",
        seedPrompt: "",
        displayMode: "cover",
        config: {
          autoExtend: false,
          refillThreshold: 2,
          batchSize: 1,
          targetDurationSec: 180,
          allowVocals: true,
        },
        createdAt: 1000,
        updatedAt,
      },
      tracks: [
        {
          id: "trk_blue",
          title: "Blue",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 180,
          createdAt: 1000,
          liked: false,
          tags: [],
          media: {
            url: "objects/media/blue.mp3",
            mime: "audio/mpeg",
            bytes: 3,
            sha256: "media-sha",
          },
          memories: [
            {
              id: "mem_blue_note",
              note: "Remote note",
              createdAt: 1000,
            },
          ],
        },
      ],
    },
    tracks: [
      {
        id: "trk_blue",
        title: "Blue",
        mediaUrl: "https://music.example.com/muzero/objects/media/blue.mp3",
        memoryPhotoUrls: [],
        source: {
          id: "trk_blue",
          title: "Blue",
          kind: "audio",
          origin: "uploaded",
          provider: "upload",
          durationSec: 180,
          createdAt: 1000,
          liked: false,
          tags: [],
          media: {
            url: "objects/media/blue.mp3",
            mime: "audio/mpeg",
            bytes: 3,
            sha256: "media-sha",
          },
          memories: [
            {
              id: "mem_blue_note",
              note: "Remote note",
              createdAt: 1000,
            },
          ],
        },
      },
    ],
  };
}

function syncObject(key: string, sha256: string): SyncObject {
  return {
    id: `drv_1:${key}`,
    driveId: "drv_1",
    key,
    kind: "set-index",
    contentType: "application/json",
    bytes: 1,
    sha256,
    updatedAt: 1000,
  };
}

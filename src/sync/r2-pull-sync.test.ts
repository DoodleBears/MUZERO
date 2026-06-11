import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, MediaBlob, Track } from "@/db/types";
import { applyRemoteSetPull, dryRunRemoteSetPull } from "./r2-pull-sync";
import type { RemoteSetIndexResult } from "./r2-subscription";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-r2-pull-sync-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("R2 pull sync", () => {
  it("dry-runs a remote create without mutating IndexedDB", async () => {
    const preview = await dryRunRemoteSetPull({ driveId: "drv_1", remoteSet: remoteSet() }, db);

    expect(preview).toMatchObject({
      action: "create-set",
      willMutate: true,
      trackCount: 1,
      bytes: 3,
    });
    expect(await db.sessions.count()).toBe(0);
    expect(await db.tracks.count()).toBe(0);
  });

  it("applies a remote set as stream rows without downloading media bytes", async () => {
    const result = await applyRemoteSetPull({ driveId: "drv_1", remoteSet: remoteSet() }, db);

    expect(result.sessionId).toBeDefined();
    const session = await db.sessions.get(result.sessionId!);
    const track = await db.tracks.get(result.trackIds[0]!);

    expect(result).toMatchObject({ action: "create-set", trackIds: expect.any(Array) });
    expect(session?.name).toBe("Tokyo");
    expect(track).toMatchObject({
      title: "Blue",
      remoteMediaUrl: "https://music.example.com/muzero/objects/media/blue.mp3",
    });
    expect(track?.blobId).toBeUndefined();
    expect(await db.mediaBlobs.count()).toBe(0);
    expect(await db.syncRuns.toArray()).toMatchObject([{ direction: "pull", status: "completed" }]);
  });

  it("can download pulled remote media for offline playback", async () => {
    const fetcher = async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });

    const result = await applyRemoteSetPull(
      {
        driveId: "drv_1",
        remoteSet: remoteSet(),
        cacheMedia: {
          fetcher,
        },
      },
      db,
    );
    const track = await db.tracks.get(result.trackIds[0]!);

    expect(result.cachedMedia).toBe(1);
    expect(track?.blobId).toBeDefined();
    expect(await db.mediaBlobs.get(track?.blobId ?? "")).toMatchObject({
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
    });
  });

  it("completes the pull when only optional media caching fails (F7)", async () => {
    const fetcher = async () => new Response(null, { status: 500 });

    const result = await applyRemoteSetPull(
      { driveId: "drv_1", remoteSet: remoteSet(), cacheMedia: { fetcher } },
      db,
    );

    // The set imported fine — caching is optional, so the run is not a failure.
    expect(result.sessionId).toBeDefined();
    expect(result.cachedMedia).toBe(0);
    expect(result.cacheFailures).toBe(1);
    expect(await db.sessions.count()).toBe(1);
    expect(await db.syncRuns.toArray()).toMatchObject([
      { direction: "pull", status: "completed", failed: 1 },
    ]);
  });

  it("repairs an existing set shell whose track metadata is incomplete", async () => {
    await seedLocalImportedSet({ updatedAt: 1000 });
    await db.tracks.update("trk_remote_drv_1_trk_blue", {
      title: "Blue",
      blobId: undefined,
      mediaMetadata: undefined,
    });
    const remote = remoteSet({ updatedAt: 1000 });
    remote.tracks[0]!.source.mediaMetadata = {
      title: "Blue",
      artists: ["A Device"],
      album: "Cloud Album",
      originalFileName: "blue.mp3",
      originalMime: "audio/mpeg",
      parser: "music-metadata",
      parsedAt: 1000,
    };

    const result = await applyRemoteSetPull({ driveId: "drv_1", remoteSet: remote }, db);

    expect(result.action).toBe("apply-remote");
    await expect(db.sessions.count()).resolves.toBe(1);
    await expect(db.tracks.get("trk_remote_drv_1_trk_blue")).resolves.toMatchObject({
      mediaMetadata: {
        album: "Cloud Album",
        artists: ["A Device"],
      },
    });
  });

  it("refreshes source attribution on unchanged imported tracks", async () => {
    await seedLocalImportedSet({ updatedAt: 1000 });
    await db.sessions.update("ses_remote_drv_1_ses_tokyo", {
      cloudSource: {
        driveId: "drv_1",
        driveLabel: "Studio R2",
        devicePublicId: "dvc_friend",
        avatarSeed: "dvc_friend",
      },
    });
    await db.tracks.update("trk_remote_drv_1_trk_blue", {
      title: "Blue",
      blobId: undefined,
      cloudSource: {
        driveId: "drv_1",
        driveLabel: "Studio R2",
        devicePublicId: "dvc_friend",
        avatarSeed: "dvc_friend",
      },
    });

    const result = await applyRemoteSetPull(
      {
        driveId: "drv_1",
        remoteSet: remoteSet({ updatedAt: 1000 }),
        source: {
          driveId: "drv_1",
          driveLabel: "Studio R2",
          devicePublicId: "dvc_friend",
          displayName: "Friend phone",
          avatarSeed: "green",
          avatarUrl: "https://music.example.com/muzero/objects/avatars/friend.jpg",
        },
      },
      db,
    );

    expect(result.action).toBe("unchanged");
    await expect(db.sessions.get("ses_remote_drv_1_ses_tokyo")).resolves.toMatchObject({
      cloudSource: {
        displayName: "Friend phone",
        avatarSeed: "green",
        avatarUrl: "https://music.example.com/muzero/objects/avatars/friend.jpg",
      },
    });
    await expect(db.tracks.get("trk_remote_drv_1_trk_blue")).resolves.toMatchObject({
      cloudSource: {
        displayName: "Friend phone",
        avatarSeed: "green",
        avatarUrl: "https://music.example.com/muzero/objects/avatars/friend.jpg",
      },
    });
  });

  it("refreshes source attribution even when remote content is unchanged", async () => {
    await applyRemoteSetPull(
      {
        driveId: "drv_1",
        remoteSet: remoteSet(),
        source: {
          driveId: "drv_1",
          driveLabel: "Shared Drive",
          devicePublicId: "dvc_old",
          displayName: "Old laptop",
          avatarSeed: "blue",
        },
      },
      db,
    );

    const result = await applyRemoteSetPull(
      {
        driveId: "drv_1",
        remoteSet: remoteSet(),
        source: {
          driveId: "drv_1",
          driveLabel: "Shared Drive",
          devicePublicId: "dvc_new",
          displayName: "New studio",
          avatarSeed: "green",
          avatarUrl: "https://music.example.com/muzero/objects/avatars/new.jpg",
        },
      },
      db,
    );

    expect(result).toMatchObject({ action: "unchanged", willMutate: false });
    await expect(db.sessions.get("ses_remote_drv_1_ses_tokyo")).resolves.toMatchObject({
      cloudSource: {
        devicePublicId: "dvc_new",
        displayName: "New studio",
        avatarSeed: "green",
      },
    });
    await expect(db.tracks.get("trk_remote_drv_1_trk_blue")).resolves.toMatchObject({
      cloudSource: {
        devicePublicId: "dvc_new",
        avatarUrl: "https://music.example.com/muzero/objects/avatars/new.jpg",
      },
    });
  });

  it("marks the run cancelled and never mutates when the pull is aborted (F6)", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      applyRemoteSetPull(
        { driveId: "drv_1", remoteSet: remoteSet(), signal: controller.signal },
        db,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(await db.sessions.count()).toBe(0);
    expect(await db.tracks.count()).toBe(0);
    expect(await db.syncRuns.toArray()).toMatchObject([{ direction: "pull", status: "cancelled" }]);
  });

  it("does not mutate when the diff is blocked", async () => {
    await db.sessions.put({
      id: "ses_remote_drv_1_ses_tokyo",
      name: "Tokyo",
      seedPrompt: "",
      trackIds: [],
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
      updatedAt: 1000,
    });
    await db.syncObjects.put({
      id: "drv_1:sets/ses_tokyo/index.json",
      driveId: "drv_1",
      key: "sets/ses_tokyo/index.json",
      kind: "set-index",
      contentType: "application/json",
      bytes: 1,
      sha256: "old",
      updatedAt: 1000,
    });

    await expect(
      applyRemoteSetPull(
        {
          driveId: "drv_1",
          remoteSet: remoteSet({ updatedAt: 2000 }),
          remoteIndexSha256: "new",
        },
        db,
      ),
    ).rejects.toThrow(/hash-mismatch/i);

    expect(await db.tracks.count()).toBe(0);
  });

  it("surfaces conflicts and never overwrites local media during a pull", async () => {
    await seedLocalImportedSet({ updatedAt: 1500 });
    await db.syncMutations.put({
      id: "mut_track_title",
      driveId: "drv_1",
      devicePublicId: "dvc_1",
      scope: "track",
      entityId: "trk_remote_drv_1_trk_blue",
      action: "track-metadata-updated",
      base: { remoteKey: "sets/ses_tokyo/index.json", updatedAt: 1000 },
      payload: { title: "Local Blue" },
      createdAt: 1600,
    });

    const preview = await dryRunRemoteSetPull(
      { driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) },
      db,
    );

    expect(preview).toMatchObject({
      action: "conflict",
      willMutate: false,
      conflict: {
        entityType: "track",
        entityId: "trk_blue",
        localMutationIds: ["mut_track_title"],
      },
    });
    await expect(
      applyRemoteSetPull({ driveId: "drv_1", remoteSet: remoteSet({ updatedAt: 2000 }) }, db),
    ).rejects.toThrow(/conflict/i);
    await expect(db.tracks.get("trk_remote_drv_1_trk_blue")).resolves.toMatchObject({
      title: "Local Blue",
      blobId: "blb_local_media",
    });
    await expect(db.mediaBlobs.toArray()).resolves.toMatchObject([
      {
        id: "blb_local_media",
        role: "media",
        bytes: 5,
      },
    ]);
  });
});

async function seedLocalImportedSet(input: { updatedAt: number }) {
  const session: DjSession = {
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
  const track: Track = {
    id: "trk_remote_drv_1_trk_blue",
    sessionId: session.id,
    title: "Local Blue",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    blobId: "blb_local_media",
    remoteMediaUrl: "https://music.example.com/muzero/objects/media/blue.mp3",
    createdAt: 1000,
    playCount: 0,
    liked: false,
    tags: [],
  };
  const media: MediaBlob = {
    id: "blb_local_media",
    trackId: track.id,
    role: "media",
    mime: "audio/mpeg",
    bytes: 5,
    blob: new Blob(["local"], { type: "audio/mpeg" }),
  };
  await db.sessions.put(session);
  await db.tracks.put(track);
  await db.mediaBlobs.put(media);
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
          memories: [],
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
          memories: [],
        },
      },
    ],
  };
}

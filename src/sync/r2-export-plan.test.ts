import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import type { DjSession, MediaBlob, Memory, Track } from "@/db/types";
import { buildR2ExportPlan } from "./r2-export-plan";

let db: MuzeroDB;
let dbName: string;

describe("buildR2ExportPlan", () => {
  beforeEach(() => {
    dbName = `muzero-r2-export-plan-${Math.random().toString(36).slice(2)}`;
    db = new MuzeroDB(dbName);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = req.onerror = () => resolve();
    });
  });

  it("plans media, covers, memory photos, set index, then root manifest", async () => {
    await seedSet();

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual([
      "media",
      "cover",
      "memory-photo",
      "set-index",
      "manifest",
    ]);
    expect(plan.objects.at(-1)).toMatchObject({
      kind: "manifest",
      key: "manifest.json",
      contentType: "application/json",
    });
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );
    expect(setIndex.tracks[0].memories[0].author).toEqual({
      devicePublicId: "dvc_studio",
      displayName: "Studio laptop",
      avatarSeed: "blue",
    });
    expect(setIndex.tracks[0].memories[0].atSec).toBe(137);
    expect(setIndex.tracks[0].mediaMetadata).toMatchObject({
      album: "Blue City",
      artists: ["Doodle Bear"],
    });
    expect(plan.totalBytes).toBe(plan.objects.reduce((sum, object) => sum + object.bytes, 0));
  });

  it("uses content-addressed keys for binary media", async () => {
    await seedSet();

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.find((object) => object.kind === "media")?.key).toMatch(
      /^objects\/media\/sha256-[a-f0-9]{64}\.mp3$/,
    );
    expect(plan.objects.find((object) => object.kind === "cover")?.key).toMatch(
      /^objects\/covers\/sha256-[a-f0-9]{64}\.jpg$/,
    );
    expect(plan.objects.find((object) => object.kind === "memory-photo")?.key).toMatch(
      /^objects\/memories\/sha256-[a-f0-9]{64}\.png$/,
    );
  });

  it("exports uploaded video media as content-addressed mp4 objects", async () => {
    await seedSet();
    await db.tracks.update("trk_1", { kind: "video" });
    await db.mediaBlobs.update("blb_media", {
      mime: "video/mp4",
      blob: new Blob(["mp4"], { type: "video/mp4" }),
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.find((object) => object.kind === "media")).toMatchObject({
      contentType: "video/mp4",
      key: expect.stringMatching(/^objects\/media\/sha256-[a-f0-9]{64}\.mp4$/),
    });
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );
    expect(setIndex.tracks[0]).toMatchObject({
      kind: "video",
      media: {
        mime: "video/mp4",
      },
    });
  });

  it("skips remote-only tracks because they have no local bytes to publish", async () => {
    await seedSet({ remoteOnly: true });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual(["set-index", "manifest"]);
  });

  it("never exports streamed-origin tracks (even cached) and counts only exported tracks (F5)", async () => {
    await seedSet();
    // A cached streamed track in the same set: it HAS local bytes (blobId), but
    // platform-derived media must never publish (streaming PRD scope).
    const streamed: Track = {
      id: "trk_yt",
      sessionId: "ses_1",
      title: "Stream Cache",
      kind: "audio",
      origin: "streamed",
      provider: "youtube",
      status: "ready",
      durationSec: 99,
      blobId: "blb_yt",
      createdAt: 110,
      playCount: 0,
      liked: false,
      tags: [],
    };
    await db.tracks.put(streamed);
    await db.mediaBlobs.put({
      id: "blb_yt",
      trackId: "trk_yt",
      role: "media",
      mime: "audio/mpeg",
      bytes: 3,
      blob: new Blob(["xyz"], { type: "audio/mpeg" }),
    });
    await db.sessions.update("ses_1", { trackIds: ["trk_1", "trk_yt"] });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.filter((object) => object.kind === "media")).toHaveLength(1);
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );
    expect(setIndex.tracks.map((track: { id: string }) => track.id)).toEqual(["trk_1"]);
    // Manifest trackCount reflects what subscribers actually receive, not the
    // session's full member list (which still holds the skipped streamed track).
    const manifest = JSON.parse(
      String(plan.objects.find((object) => object.kind === "manifest")?.body),
    );
    expect(manifest.sets[0].trackCount).toBe(1);
  });

  it("keeps historical memory author snapshots when the local device profile changes", async () => {
    await seedSet();
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_studio",
      name: "Renamed laptop",
      avatarSeed: "green",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: true,
      profileRevision: 2,
      createdAt: 100,
      lastSeenAt: 300,
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );

    expect(setIndex.tracks[0].memories[0].author).toEqual({
      devicePublicId: "dvc_studio",
      displayName: "Studio laptop",
      avatarSeed: "blue",
    });
    const deviceProfile = JSON.parse(
      String(plan.objects.find((object) => object.kind === "device-profile")?.body),
    );
    expect(deviceProfile.displayName).toBe("Renamed laptop");
  });

  it("adds current-device profile, stats aggregate, and owner-maintained indexes", async () => {
    await seedSet();
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_1",
      name: "Mac desktop",
      avatarSeed: "ocean-blue",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: true,
      profileRevision: 2,
      createdAt: 100,
      lastSeenAt: 200,
    });
    await db.playbackAggregates.put({
      id: "dvc_1:track:trk_1",
      devicePublicId: "dvc_1",
      scope: "track",
      trackId: "trk_1",
      playCount: 2,
      listenedSec: 62,
      lastPlayedAt: 300,
      updatedAt: 300,
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.objects.map((object) => object.kind)).toEqual([
      "media",
      "cover",
      "memory-photo",
      "set-index",
      "device-profile",
      "stats-aggregate",
      "devices-index",
      "stats-index",
      "manifest",
    ]);
    expect(plan.objects.find((object) => object.kind === "device-profile")?.key).toBe(
      "profiles/devices/dvc_1/profile.json",
    );
    const devicesIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "devices-index")?.body),
    );
    expect(devicesIndex.devices[0]).toMatchObject({
      publicId: "dvc_1",
      displayName: "Mac desktop",
      avatarSeed: "ocean-blue",
    });
    expect(plan.objects.find((object) => object.kind === "stats-aggregate")?.key).toBe(
      "stats/devices/dvc_1/aggregate.json",
    );
  });

  it("exports uploaded device avatar images through the public profile object", async () => {
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_1",
      name: "Mac desktop",
      avatarSeed: "ocean-blue",
      avatarBlobId: "blb_avatar",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: true,
      profileRevision: 2,
      createdAt: 100,
      lastSeenAt: 200,
    });
    await db.mediaBlobs.put({
      id: "blb_avatar",
      trackId: "dev_local",
      role: "avatar",
      mime: "image/png",
      bytes: 6,
      blob: new Blob(["avatar"], { type: "image/png" }),
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });
    const avatar = plan.objects.find((object) => object.kind === "device-avatar");
    const profile = JSON.parse(
      String(plan.objects.find((object) => object.kind === "device-profile")?.body),
    );

    expect(avatar).toMatchObject({
      contentType: "image/png",
      key: expect.stringMatching(/^objects\/avatars\/sha256-[a-f0-9]{64}\.png$/),
    });
    expect(profile.avatar).toMatchObject({
      url: avatar?.key,
      mime: "image/png",
      bytes: 6,
      sha256: avatar?.sha256,
    });
  });

  it("exports per-device set mutation files for unsynced local edits", async () => {
    await db.syncMutations.put({
      id: "mut_1",
      driveId: "drv_1",
      devicePublicId: "dvc_1",
      scope: "set",
      entityId: "ses_1",
      action: "set-metadata-updated",
      base: {
        remoteKey: "sets/ses_1/index.json",
        etag: '"etag-1"',
        revision: 3,
        updatedAt: 1_000,
      },
      payload: { name: "Renamed set" },
      createdAt: 2_000,
    });
    await db.syncMutations.put({
      id: "mut_synced",
      driveId: "drv_1",
      devicePublicId: "dvc_1",
      scope: "set",
      entityId: "ses_1",
      action: "track-added-to-set",
      payload: { trackId: "trk_old" },
      createdAt: 1_000,
      syncedAt: 3_000,
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: [],
      db,
    });
    const mutation = plan.objects.find((object) => object.kind === "set-mutation");

    expect(mutation?.key).toBe("sets/ses_1/mutations/dvc_1/0000000002000-mut_1.json");
    expect(JSON.parse(String(mutation?.body))).toMatchObject({
      schema: "muzero-r2-set-mutation-v1",
      mutation: {
        id: "mut_1",
        action: "set-metadata-updated",
        base: { etag: '"etag-1"', revision: 3 },
        payload: { name: "Renamed set" },
      },
    });
    expect(plan.objects.filter((object) => object.kind === "set-mutation")).toHaveLength(1);
  });

  it("folds non-overlapping set mutations into the next owner set index snapshot", async () => {
    await seedSet();
    await db.syncMutations.bulkPut([
      {
        id: "mut_rename",
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: { name: "Folded Night Drive" },
        createdAt: 300,
      },
      {
        id: "mut_add_track",
        driveId: "drv_1",
        devicePublicId: "dvc_2",
        scope: "set",
        entityId: "ses_1",
        action: "track-added-to-set",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: {
          position: 1,
          track: {
            id: "trk_remote",
            title: "Remote Blue",
            kind: "audio",
            origin: "uploaded",
            provider: "upload",
            durationSec: 160,
            createdAt: 250,
            liked: false,
            tags: ["shared"],
            media: {
              url: "objects/media/remote-blue.mp3",
              mime: "audio/mpeg",
              bytes: 9,
              sha256: "remote-sha",
            },
            memories: [],
          },
        },
        createdAt: 320,
      },
    ]);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );

    expect(setIndex).toMatchObject({
      revision: 2,
      set: {
        name: "Folded Night Drive",
        updatedAt: 320,
      },
    });
    expect(setIndex.tracks.map((track: { id: string }) => track.id)).toEqual([
      "trk_1",
      "trk_remote",
    ]);
  });

  it("attaches set index write preconditions from the observed remote etag", async () => {
    await seedSet();

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
      setIndexPreconditions: {
        ses_1: { ifMatch: '"set-etag-1"' },
      },
    });

    expect(plan.objects.find((object) => object.kind === "set-index")).toMatchObject({
      key: "sets/ses_1/index.json",
      precondition: { ifMatch: '"set-etag-1"' },
    });
  });

  it("auto-merges different devices adding tracks and memories to the same set", async () => {
    await seedSet();
    await db.syncMutations.bulkPut([
      {
        id: "mut_add_track_a",
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "track-added-to-set",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: { position: 1, track: remoteTrack("trk_remote_a", "Remote A") },
        createdAt: 300,
      },
      {
        id: "mut_add_track_b",
        driveId: "drv_1",
        devicePublicId: "dvc_2",
        scope: "set",
        entityId: "ses_1",
        action: "track-added-to-set",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: { position: 2, track: remoteTrack("trk_remote_b", "Remote B") },
        createdAt: 310,
      },
      {
        id: "mut_add_memory",
        driveId: "drv_1",
        devicePublicId: "dvc_3",
        scope: "memory",
        entityId: "mem_remote_extra",
        action: "memory-added",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: {
          trackId: "trk_1",
          memory: {
            id: "mem_remote_extra",
            note: "Shared memory",
            author: { devicePublicId: "dvc_3", displayName: "Phone" },
            createdAt: 330,
          },
        },
        createdAt: 330,
      },
    ]);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });
    const setIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "set-index")?.body),
    );

    expect(setIndex.tracks.map((track: { id: string }) => track.id)).toEqual([
      "trk_1",
      "trk_remote_a",
      "trk_remote_b",
    ]);
    expect(setIndex.tracks[0].memories.map((memory: { id: string }) => memory.id)).toEqual([
      "mem_1",
      "mem_remote_extra",
    ]);
  });

  it("reports a reviewable conflict when two devices rename the same set differently", async () => {
    await seedSet();
    await db.syncMutations.bulkPut([
      {
        id: "mut_rename_a",
        driveId: "drv_1",
        devicePublicId: "dvc_1",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: { name: "Device A Mix" },
        createdAt: 300,
      },
      {
        id: "mut_rename_b",
        driveId: "drv_1",
        devicePublicId: "dvc_2",
        scope: "set",
        entityId: "ses_1",
        action: "set-metadata-updated",
        base: { remoteKey: "sets/ses_1/index.json", revision: 1, updatedAt: 200 },
        payload: { name: "Device B Mix" },
        createdAt: 310,
      },
    ]);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    expect(plan.conflicts).toMatchObject([
      {
        setId: "ses_1",
        entityType: "set",
        entityId: "ses_1",
        field: "name",
        reason: "overlapping-mutations",
        mutationIds: ["mut_rename_a", "mut_rename_b"],
      },
    ]);
  });

  it("exports immutable per-device playback event segments", async () => {
    await seedSet();
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_1",
      name: "Mac desktop",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: false,
      profileRevision: 1,
      createdAt: 100,
      lastSeenAt: 200,
    });
    await db.playbackEvents.bulkPut([
      {
        id: "ple_1",
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        context: { source: "local", setId: "ses_1" },
        startedAt: 1000,
        endedAt: 31_000,
        listenedSec: 31,
        countedAsPlay: true,
      },
      {
        id: "ple_2",
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        context: { source: "local", setId: "ses_1" },
        startedAt: 40_000,
        endedAt: 45_000,
        listenedSec: 5,
        countedAsPlay: false,
      },
    ]);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
    });

    const segment = plan.objects.find((object) => object.kind === "stats-events-segment");
    expect(segment?.key).toMatch(/^stats\/events\/dvc_1\/1000-40000-[a-f0-9]{16}\.json$/);
    const body = JSON.parse(String(segment?.body));
    expect(body).toMatchObject({
      schema: "muzero-r2-playback-events-segment-v1",
      devicePublicId: "dvc_1",
      startedAt: 1000,
      endedAt: 40_000,
      eventCount: 2,
    });
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(["ple_1", "ple_2"]);
    const checkpoint = plan.objects.find((object) => object.kind === "stats-checkpoint");
    expect(checkpoint?.key).toBe("stats/devices/dvc_1/checkpoint.json");
    expect(JSON.parse(String(checkpoint?.body))).toMatchObject({
      schema: "muzero-r2-playback-checkpoint-v1",
      devicePublicId: "dvc_1",
      lastEventId: "ple_2",
      lastStartedAt: 40_000,
      eventCount: 2,
      segment: segment?.key,
    });
    const statsIndex = plan.objects.find((object) => object.kind === "stats-index");
    expect(JSON.parse(String(statsIndex?.body))).toMatchObject({
      schema: "muzero-r2-stats-index-v1",
      devices: [
        {
          devicePublicId: "dvc_1",
          checkpoint: "stats/devices/dvc_1/checkpoint.json",
          latestSegment: segment?.key,
        },
      ],
    });
  });

  it("exports local listening history for shared remote tracks to the owner drive without media", async () => {
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_1",
      name: "Mac desktop",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: false,
      profileRevision: 1,
      createdAt: 100,
      lastSeenAt: 200,
    });
    await db.playbackAggregates.put({
      id: "dvc_1:track-in-share:shr_tokyo:remote_trk_1",
      devicePublicId: "dvc_1",
      scope: "track-in-share",
      driveId: "drv_friend",
      shareId: "shr_tokyo",
      setId: "ses_tokyo",
      remoteTrackId: "remote_trk_1",
      mediaSha256: "sha256-blue",
      playCount: 1,
      listenedSec: 45,
      lastPlayedAt: 45_000,
      updatedAt: 45_000,
    });
    await db.playbackEvents.put({
      id: "ple_remote",
      devicePublicId: "dvc_1",
      remoteTrackRef: {
        driveId: "drv_friend",
        shareId: "shr_tokyo",
        setId: "ses_tokyo",
        trackId: "remote_trk_1",
        mediaSha256: "sha256-blue",
      },
      context: {
        source: "shared-drive",
        driveId: "drv_friend",
        shareId: "shr_tokyo",
        setId: "ses_tokyo",
      },
      startedAt: 1_000,
      endedAt: 45_000,
      listenedSec: 45,
      countedAsPlay: true,
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_owner",
      libraryId: "lib_owner",
      baseUrl: "https://owner.example.com/muzero/",
      setIds: [],
      db,
      playbackEventFlush: { mode: "manual", now: 60_000 },
    });
    const aggregate = JSON.parse(
      String(plan.objects.find((object) => object.kind === "stats-aggregate")?.body),
    );
    const segment = JSON.parse(
      String(plan.objects.find((object) => object.kind === "stats-events-segment")?.body),
    );

    expect(plan.objects.some((object) => object.kind === "media")).toBe(false);
    expect(aggregate.aggregates[0]).toMatchObject({
      scope: "track-in-share",
      shareId: "shr_tokyo",
      remoteTrackId: "remote_trk_1",
      mediaSha256: "sha256-blue",
      playCount: 1,
    });
    expect(segment.events[0]).toMatchObject({
      remoteTrackRef: {
        driveId: "drv_friend",
        shareId: "shr_tokyo",
        setId: "ses_tokyo",
        trackId: "remote_trk_1",
      },
    });
  });

  it("keeps trusted-device stats separated under that device public id", async () => {
    await db.devices.put({
      id: "dev_local",
      publicId: "dvc_trusted_phone",
      name: "Trusted phone",
      platform: "browser",
      appVersion: "0.1.0",
      publishProfile: false,
      profileRevision: 1,
      createdAt: 100,
      lastSeenAt: 200,
    });
    await db.playbackAggregates.put({
      id: "dvc_trusted_phone:track:remote_trk_1",
      devicePublicId: "dvc_trusted_phone",
      scope: "track",
      remoteTrackId: "remote_trk_1",
      mediaSha256: "sha256-blue",
      playCount: 3,
      listenedSec: 135,
      lastPlayedAt: 135_000,
      updatedAt: 135_000,
    });

    const plan = await buildR2ExportPlan({
      driveId: "drv_trusted",
      libraryId: "lib_shared",
      baseUrl: "https://shared.example.com/muzero/",
      setIds: [],
      db,
    });

    expect(plan.objects.find((object) => object.kind === "stats-aggregate")?.key).toBe(
      "stats/devices/dvc_trusted_phone/aggregate.json",
    );
    const statsIndex = JSON.parse(
      String(plan.objects.find((object) => object.kind === "stats-index")?.body),
    );
    expect(statsIndex.devices[0]).toMatchObject({
      devicePublicId: "dvc_trusted_phone",
      aggregate: "stats/devices/dvc_trusted_phone/aggregate.json",
    });
  });

  it("does not export playback event segments during auto sync before policy thresholds", async () => {
    await seedSet();
    await seedDeviceWithPlaybackEvents(10, 1_000);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
      playbackEventFlush: {
        mode: "auto",
        now: 2_000,
      },
    });

    expect(plan.objects.some((object) => object.kind === "stats-events-segment")).toBe(false);
    expect(plan.objects.some((object) => object.kind === "stats-checkpoint")).toBe(false);
  });

  it("exports playback event segments during auto sync when count threshold is reached", async () => {
    await seedSet();
    await seedDeviceWithPlaybackEvents(25, 1_000);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
      playbackEventFlush: {
        eventThreshold: 25,
        mode: "auto",
        now: 2_000,
      },
    });

    expect(plan.objects.some((object) => object.kind === "stats-events-segment")).toBe(true);
    expect(plan.objects.some((object) => object.kind === "stats-checkpoint")).toBe(true);
  });

  it("exports playback event segments during auto sync when age threshold is reached", async () => {
    await seedSet();
    await seedDeviceWithPlaybackEvents(1, 1_000);

    const plan = await buildR2ExportPlan({
      driveId: "drv_1",
      libraryId: "lib_1",
      baseUrl: "https://music.example.com/muzero/",
      setIds: ["ses_1"],
      db,
      playbackEventFlush: {
        maxAgeMs: 5 * 60_000,
        mode: "auto",
        now: 301_000,
      },
    });

    expect(plan.objects.some((object) => object.kind === "stats-events-segment")).toBe(true);
    expect(plan.objects.some((object) => object.kind === "stats-checkpoint")).toBe(true);
  });
});

async function seedSet(options: { remoteOnly?: boolean } = {}) {
  const session: DjSession = {
    id: "ses_1",
    name: "Night Drive",
    seedPrompt: "city pop at midnight",
    trackIds: ["trk_1"],
    status: "idle",
    config: {
      autoExtend: false,
      refillThreshold: 2,
      batchSize: 1,
      targetDurationSec: 180,
      allowVocals: true,
    },
    displayMode: "video",
    createdAt: 100,
    updatedAt: 200,
  };
  const track: Track = {
    id: "trk_1",
    sessionId: "ses_1",
    title: "Blue Avenue",
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 180,
    blobId: options.remoteOnly ? undefined : "blb_media",
    remoteMediaUrl: options.remoteOnly ? "https://other.example.com/blue.mp3" : undefined,
    coverBlobId: options.remoteOnly ? undefined : "blb_cover",
    createdAt: 100,
    playCount: 0,
    liked: false,
    tags: ["city"],
    mediaMetadata: {
      album: "Blue City",
      artists: ["Doodle Bear"],
      originalFileName: "blue-avenue.mp3",
      originalMime: "audio/mpeg",
      parser: "music-metadata",
      parsedAt: 100,
      title: "Blue Avenue",
    },
  };
  const memory: Memory = {
    id: "mem_1",
    trackId: "trk_1",
    note: "First listen in Shibuya.",
    photoBlobId: options.remoteOnly ? undefined : "blb_memory",
    author: {
      devicePublicId: "dvc_studio",
      displayName: "Studio laptop",
      avatarSeed: "blue",
    },
    createdAt: 150,
    atSec: 137,
  };
  const blobs: MediaBlob[] = options.remoteOnly
    ? []
    : [
        {
          id: "blb_media",
          trackId: "trk_1",
          role: "media",
          mime: "audio/mpeg",
          bytes: 3,
          blob: new Blob(["abc"], { type: "audio/mpeg" }),
        },
        {
          id: "blb_cover",
          trackId: "trk_1",
          role: "cover",
          mime: "image/jpeg",
          bytes: 3,
          blob: new Blob(["def"], { type: "image/jpeg" }),
        },
        {
          id: "blb_memory",
          trackId: "trk_1",
          role: "memory",
          mime: "image/png",
          bytes: 3,
          blob: new Blob(["ghi"], { type: "image/png" }),
        },
      ];

  await db.sessions.put(session);
  await db.tracks.put(track);
  await db.memories.put(memory);
  await db.mediaBlobs.bulkPut(blobs);
}

function remoteTrack(id: string, title: string) {
  return {
    id,
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    durationSec: 160,
    createdAt: 250,
    liked: false,
    tags: ["shared"],
    media: {
      url: `objects/media/${id}.mp3`,
      mime: "audio/mpeg",
      bytes: 9,
      sha256: `${id}-sha`,
    },
    memories: [],
  };
}

async function seedDeviceWithPlaybackEvents(count: number, firstStartedAt: number) {
  await db.devices.put({
    id: "dev_local",
    publicId: "dvc_1",
    name: "Mac desktop",
    platform: "browser",
    appVersion: "0.1.0",
    publishProfile: false,
    profileRevision: 1,
    createdAt: 100,
    lastSeenAt: 200,
  });
  await db.playbackEvents.bulkPut(
    Array.from({ length: count }, (_, index) => {
      const startedAt = firstStartedAt + index * 1_000;
      return {
        id: `ple_${index}`,
        devicePublicId: "dvc_1",
        trackId: "trk_1",
        context: { source: "local", setId: "ses_1" },
        startedAt,
        endedAt: startedAt + 31_000,
        listenedSec: 31,
        countedAsPlay: true,
      };
    }),
  );
}

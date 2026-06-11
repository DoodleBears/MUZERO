import { type MediaBlobStorageOptions, resolveMediaBlob } from "@/db/media-blob-storage";
import type { MuzeroDB } from "@/db/muzero-db";
import { db as defaultDb } from "@/db/muzero-db";
import type {
  AppSettings,
  CloudDrive,
  DevicePublicProfile,
  DeviceRecord,
  DjSession,
  MediaBlob,
  Memory,
  PlaybackAggregate,
  PlaybackEvent,
  SyncMutation,
  Track,
} from "@/db/types";
import { orderedSetTrackIds } from "@/player/set-order";
import {
  type PlaybackEventFlushPolicy,
  shouldFlushPlaybackEventSegment,
} from "./playback-event-segments";
import { publishedEntityId } from "./r2-import-stream";
import {
  type R2DevicesIndex,
  type R2EntityCoverEntry,
  type R2Manifest,
  type R2PresenceIndex,
  type R2SetIndex,
  type R2StatsIndex,
  r2DjConfigSchema,
  r2MemorySchema,
  r2SetTrackSchema,
} from "./r2-manifest-schema";
import { canWritePresenceToDrive } from "./r2-presence";
import type { RemoteBaseObject, RemotePublishBase } from "./r2-publish-base";
import {
  mergeDevicesIndex,
  mergeManifestSets,
  mergePresenceIndex,
  mergeSetIndex,
  mergeStatsIndex,
} from "./r2-publish-merge";
import { canPublishDeviceProfileToDrive, canWriteStatsToDrive } from "./r2-stats-policy";

type R2RemoteObject = R2SetIndex["tracks"][number]["media"];

export type R2ExportObjectKind =
  | "media"
  | "cover"
  | "memory-photo"
  | "device-avatar"
  | "set-index"
  | "set-mutation"
  | "device-profile"
  | "devices-index"
  | "presence-index"
  | "stats-events-segment"
  | "stats-checkpoint"
  | "stats-aggregate"
  | "stats-index"
  | "entity-cover"
  | "entity-covers-index"
  | "manifest";

export interface R2ExportObject {
  kind: R2ExportObjectKind;
  key: string;
  contentType: string;
  bytes: number;
  body: Blob | string;
  sha256?: string;
  precondition?: R2ObjectWritePrecondition;
  setId?: string;
  trackId?: string;
  memoryId?: string;
}

export interface R2ObjectWritePrecondition {
  ifMatch?: string;
  ifNoneMatch?: string;
}

export interface R2ExportPlan {
  driveId: string;
  libraryId: string;
  baseUrl: string;
  objects: R2ExportObject[];
  totalBytes: number;
  conflicts?: R2ExportConflict[];
}

export interface R2ExportConflict {
  setId: string;
  entityType: "set" | "track" | "memory";
  entityId: string;
  field?: string;
  reason: "overlapping-mutations";
  mutationIds: string[];
}

export interface R2ExportPlanInput {
  driveId: string;
  libraryId: string;
  baseUrl: string;
  setIds: string[];
  db?: MuzeroDB;
  deviceExport?: R2DeviceExportOptions;
  playbackEventFlush?: R2PlaybackEventFlushOptions;
  setIndexPreconditions?: Record<string, R2ObjectWritePrecondition>;
  /**
   * The current remote manifest/indexes (+ ETags) for a read-merge-write
   * multi-writer publish (PRD §12.4). When provided, discovery indexes merge
   * with the remote entries, the manifest unions sets by ownership, and the
   * merged JSON writes carry `If-Match`/`If-None-Match` preconditions. When
   * omitted, the plan keeps the legacy single-writer mirror behavior.
   */
  remoteBase?: RemotePublishBase;
  /** Runtime/test injection for provider-backed local media rows. */
  mediaStorage?: MediaBlobStorageOptions;
}

export interface R2PlaybackEventFlushOptions extends Partial<PlaybackEventFlushPolicy> {
  mode: "auto" | "manual";
  now: number;
}

export interface R2DeviceExportOptions {
  publishProfile?: boolean;
  publishStats?: boolean;
  publishPresence?: boolean;
  profilePrecondition?: R2ObjectWritePrecondition;
}

export interface R2ExportPlanForDriveInput
  extends Omit<R2ExportPlanInput, "driveId" | "deviceExport"> {
  drive: CloudDrive;
  settings: AppSettings;
  deviceProfileBase?: {
    etag?: string;
  };
}

interface BinaryObjectResult {
  object: R2ExportObject;
  remote: R2RemoteObject;
}

export async function buildR2ExportPlanForDrive(
  input: R2ExportPlanForDriveInput,
): Promise<R2ExportPlan> {
  const db = input.db ?? defaultDb;
  const device = await db.devices.get("dev_local");
  const publishProfile = device
    ? canPublishDeviceProfileToDrive(device, input.settings, input.drive)
    : false;
  const publishStats = canWriteStatsToDrive(input.settings, input.drive);
  const publishPresence = canWritePresenceToDrive(input.settings, input.drive);

  return buildR2ExportPlan({
    driveId: input.drive.id,
    libraryId: input.libraryId,
    baseUrl: input.baseUrl,
    setIds: input.setIds,
    db,
    playbackEventFlush: input.playbackEventFlush,
    setIndexPreconditions: input.setIndexPreconditions,
    remoteBase: input.remoteBase,
    deviceExport: {
      publishProfile,
      publishStats,
      publishPresence,
      profilePrecondition: writeIfMatchPrecondition(input.deviceProfileBase?.etag),
    },
  });
}

export async function buildR2ExportPlan(input: R2ExportPlanInput): Promise<R2ExportPlan> {
  const db = input.db ?? defaultDb;
  const binaryObjects: R2ExportObject[] = [];
  const setIndexes: Array<{
    session: DjSession;
    publishedId: string;
    trackCount: number;
    object: R2ExportObject;
  }> = [];
  const conflicts: R2ExportConflict[] = [];

  for (const setId of input.setIds) {
    const session = await db.sessions.get(setId);
    if (!session) continue;
    const tracks = await loadSessionTracks(session, db);
    const setIndexTracks: R2SetIndex["tracks"] = [];

    // Co-editing (PRD §12.5): a set imported from THIS drive publishes back
    // under its ORIGINAL remote id; other devices' members (`trk_remote_*`
    // rows) are never re-exported — the remote side of the merge carries them.
    const publishedId = publishedEntityId("ses", input.driveId, session.id);
    const setCover = session.coverBlobId
      ? await loadOptionalBinaryObject(
          "cover",
          session.coverBlobId,
          db,
          {
            setId: session.id,
          },
          input.mediaStorage,
        )
      : undefined;
    if (setCover) binaryObjects.push(setCover.object);

    for (const track of tracks) {
      if (publishedEntityId("trk", input.driveId, track.id) !== track.id) continue;
      const mediaBlob = track.blobId
        ? await resolveMediaBlob(track.blobId, db, input.mediaStorage)
        : undefined;
      if (!mediaBlob && track.origin !== "streamed") continue;
      if (!mediaBlob && (!track.streamSourceId || !track.streamExternalId)) continue;

      const media = mediaBlob
        ? await createBinaryObject("media", mediaBlob, {
            setId: session.id,
            trackId: track.id,
          })
        : undefined;
      if (media) binaryObjects.push(media.object);

      const cover = track.coverBlobId
        ? await loadOptionalBinaryObject(
            "cover",
            track.coverBlobId,
            db,
            {
              setId: session.id,
              trackId: track.id,
            },
            input.mediaStorage,
          )
        : undefined;
      if (cover) binaryObjects.push(cover.object);

      const memories = await db.memories.where("trackId").equals(track.id).sortBy("createdAt");
      const remoteMemories = [];
      for (const memory of memories) {
        const photo = memory.photoBlobId
          ? await loadOptionalBinaryObject(
              "memory-photo",
              memory.photoBlobId,
              db,
              {
                setId: session.id,
                trackId: track.id,
                memoryId: memory.id,
              },
              input.mediaStorage,
            )
          : undefined;
        if (photo) binaryObjects.push(photo.object);
        remoteMemories.push(toRemoteMemory(memory, photo?.remote));
      }

      // Carry lyrics (LRCLIB or manual) through the manifest — synced-lyrics PRD
      // §4.8. Only real content travels; the "notFound" negative cache is local
      // (other devices re-fetch on their own).
      const lyricsRow = await db.lyrics.where("trackId").equals(track.id).first();
      const lyrics =
        lyricsRow && (lyricsRow.status === "found" || lyricsRow.status === "instrumental")
          ? {
              synced: lyricsRow.synced,
              plain: lyricsRow.plain,
              instrumental: lyricsRow.instrumental,
              source: lyricsRow.source,
              sourceId: lyricsRow.sourceId,
            }
          : undefined;

      setIndexTracks.push({
        id: track.id,
        title: track.title,
        kind: track.kind,
        origin: track.origin,
        provider: track.provider,
        durationSec: track.durationSec,
        createdAt: track.createdAt,
        generatedAt: track.generatedAt,
        liked: track.liked,
        tags: track.tags,
        mediaMetadata: track.mediaMetadata,
        brief: track.brief ?? null,
        providerPreset: track.providerPreset ?? null,
        streamSourceId: track.streamSourceId,
        streamExternalId: track.streamExternalId,
        streamMeta: track.streamMeta,
        rank: session.trackRanks?.[track.id],
        media: media?.remote,
        cover: cover?.remote,
        coverCrop: track.coverCrop,
        thumbhash: track.coverThumbhash,
        lyrics,
        memories: remoteMemories,
      });
    }

    // Removal tombstones travel under their PUBLISHED ids (PRD §12.5).
    const localRemovedTracks = Object.entries(session.removedTracks ?? {}).map(
      ([trackId, removedAt]) => ({
        id: publishedEntityId("trk", input.driveId, trackId),
        removedAt,
      }),
    );
    const merged = mergeSetIndex(
      input.remoteBase?.setIndexes?.[publishedId]?.value,
      {
        schema: "muzero-r2-set-index-v1",
        set: {
          id: publishedId,
          name: session.name,
          seedPrompt: session.seedPrompt,
          displayMode: session.displayMode,
          config: session.config,
          cover: setCover?.remote,
          coverCrop: session.coverCrop,
          thumbhash: session.coverThumbhash,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        },
        tracks: setIndexTracks,
      },
      { localRemovedTracks },
    );
    const folded = await foldSetMutationsIntoIndex(merged, input.driveId, db);
    conflicts.push(...folded.conflicts);
    setIndexes.push({
      session,
      publishedId,
      // Manifest trackCount must reflect what subscribers receive (post-skip,
      // post-merge, post-fold), not the session's full member list (audit F5).
      trackCount: folded.index.tracks.length,
      object: await createJsonObject("set-index", `sets/${publishedId}/index.json`, folded.index, {
        setId: session.id,
        precondition:
          childPrecondition(input.remoteBase, input.remoteBase?.setIndexes?.[publishedId]) ??
          sanitizeWritePrecondition(input.setIndexPreconditions?.[session.id]),
      }),
    });
  }

  const localDevice = await db.devices.get("dev_local");
  const mutationObjects = await createSetMutationObjects(input.driveId, db);
  const deviceObjects = await createDeviceObjects(
    db,
    input.playbackEventFlush,
    input.deviceExport,
    input.remoteBase,
    input.mediaStorage,
  );
  const entityCoverObjects = await createEntityCoverObjects(db, input.mediaStorage);
  const manifest = createManifest(
    input,
    setIndexes,
    [...deviceObjects, ...entityCoverObjects],
    localDevice?.publicId,
  );
  const objects = [
    ...binaryObjects,
    ...setIndexes.map(({ object }) => object),
    ...mutationObjects,
    ...deviceObjects,
    ...entityCoverObjects,
    await createJsonObject("manifest", "manifest.json", manifest, {
      precondition: basePrecondition(input.remoteBase, input.remoteBase?.manifest),
    }),
  ];

  return {
    driveId: input.driveId,
    libraryId: input.libraryId,
    baseUrl: input.baseUrl,
    objects,
    totalBytes: objects.reduce((total, object) => total + object.bytes, 0),
    conflicts,
  };
}

async function loadSessionTracks(session: DjSession, db: MuzeroDB): Promise<Track[]> {
  // Emit the manifest tracks[] in the set's DISPLAY order (fractional rank), so the
  // order travels even for readers that ignore `rank` (drag-reorder PRD §4.2).
  const orderedIds = orderedSetTrackIds(session.trackIds, session.trackRanks);
  const rows = await db.tracks.bulkGet(orderedIds);
  return rows.filter((track): track is Track => Boolean(track));
}

async function loadOptionalBinaryObject(
  kind: "cover" | "memory-photo" | "device-avatar",
  blobId: string,
  db: MuzeroDB,
  refs: Pick<R2ExportObject, "setId" | "trackId" | "memoryId">,
  mediaStorage?: MediaBlobStorageOptions,
): Promise<BinaryObjectResult | undefined> {
  const blob = await resolveMediaBlob(blobId, db, mediaStorage);
  return blob ? createBinaryObject(kind, blob, refs) : undefined;
}

async function createBinaryObject(
  kind: "media" | "cover" | "memory-photo" | "device-avatar" | "entity-cover",
  blob: MediaBlob,
  refs: Pick<R2ExportObject, "setId" | "trackId" | "memoryId">,
): Promise<BinaryObjectResult> {
  const body = blob.blob;
  if (!body) {
    throw new Error(`Cannot export ${kind} object without inline blob bytes: ${blob.id}`);
  }
  const sha256 = await sha256Blob({ ...blob, blob: body });
  const key = `${binaryDirectory(kind)}/sha256-${sha256}${extensionForMime(blob.mime)}`;
  const object: R2ExportObject = {
    kind,
    key,
    contentType: blob.mime,
    bytes: blob.bytes,
    body,
    sha256,
    ...refs,
  };
  return {
    object,
    remote: {
      key,
      url: key,
      mime: blob.mime,
      bytes: blob.bytes,
      sha256,
    },
  };
}

function toRemoteMemory(
  memory: Memory,
  photo?: R2RemoteObject,
): R2SetIndex["tracks"][number]["memories"][number] {
  return {
    id: memory.id,
    note: memory.note,
    author: memory.author,
    createdAt: memory.createdAt,
    atSec: memory.atSec,
    photo,
  };
}

async function createJsonObject(
  kind: Exclude<R2ExportObjectKind, "media" | "cover" | "memory-photo" | "device-avatar">,
  key: string,
  value: unknown,
  refs: Pick<R2ExportObject, "setId" | "precondition"> = {},
): Promise<R2ExportObject> {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  return {
    kind,
    key,
    contentType: "application/json",
    bytes: new TextEncoder().encode(body).byteLength,
    body,
    sha256: await sha256Text(body),
    ...refs,
  };
}

async function createSetMutationObjects(driveId: string, db: MuzeroDB): Promise<R2ExportObject[]> {
  const rows = await db.syncMutations.where("driveId").equals(driveId).toArray();
  return Promise.all(
    rows
      .filter((mutation) => mutation.syncedAt == null && mutation.scope === "set")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((mutation) =>
        createJsonObject(
          "set-mutation",
          setMutationKey(mutation),
          {
            schema: "muzero-r2-set-mutation-v1",
            mutation,
          },
          { setId: mutation.entityId },
        ),
      ),
  );
}

/**
 * Library-global custom covers for derived artist/album entities. Unlike
 * everything else (set-scoped under `sets/<id>/`), these live in a singleton
 * `library/entity-covers/index.json`; the bytes are content-addressed into the
 * shared `objects/covers/` directory. Rebuilt from `entityCovers` each run (the
 * content hash dedupes unchanged bytes); mutations drive conflict detection on
 * pull, not what gets exported. Returns `[]` (no index) when there are none.
 */
async function createEntityCoverObjects(
  db: MuzeroDB,
  mediaStorage?: MediaBlobStorageOptions,
): Promise<R2ExportObject[]> {
  const rows = (await db.entityCovers.toArray()).sort((a, b) => (a.id < b.id ? -1 : 1));
  const binaryObjects: R2ExportObject[] = [];
  const entries: R2EntityCoverEntry[] = [];
  for (const row of rows) {
    let cover: R2RemoteObject;
    if (row.coverBlobId) {
      // Local cover: content-address the bytes + upload them.
      const blob = await resolveMediaBlob(row.coverBlobId, db, mediaStorage);
      if (!blob) continue;
      const binary = await createBinaryObject("entity-cover", blob, {});
      binaryObjects.push(binary.object);
      cover = binary.remote;
    } else if (row.remoteCover) {
      // Imported cover: re-emit by reference (bytes already live remotely) so a
      // re-export from this device doesn't drop another device's cover.
      cover = {
        key: row.remoteCover.key,
        url: row.remoteCover.key,
        mime: row.remoteCover.mime,
        bytes: row.remoteCover.bytes,
        sha256: row.remoteCover.sha256,
      };
    } else {
      continue;
    }
    if (!cover) continue;
    entries.push({
      id: row.id,
      kind: row.kind,
      cover,
      crop: row.crop,
      thumbhash: row.thumbhash,
      updatedAt: row.updatedAt,
    });
  }
  if (entries.length === 0) return [];
  const index = await createJsonObject("entity-covers-index", "library/entity-covers/index.json", {
    schema: "muzero-r2-entity-covers-v1",
    updatedAt: entries.reduce((max, entry) => Math.max(max, entry.updatedAt), 0),
    entries,
  });
  return [...binaryObjects, index];
}

async function foldSetMutationsIntoIndex(
  index: R2SetIndex,
  driveId: string,
  db: MuzeroDB,
): Promise<{ index: R2SetIndex; conflicts: R2ExportConflict[] }> {
  const rows = await db.syncMutations.where("driveId").equals(driveId).toArray();
  const mutations = rows
    .filter(
      (mutation) =>
        mutation.syncedAt == null &&
        (mutation.scope === "set" || mutation.scope === "memory") &&
        (mutation.scope === "memory" || mutation.entityId === index.set.id) &&
        mutation.base?.remoteKey === `sets/${index.set.id}/index.json`,
    )
    .sort((a, b) => a.createdAt - b.createdAt);
  if (mutations.length === 0) return { index, conflicts: [] };

  const folded: R2SetIndex = {
    ...index,
    set: { ...index.set },
    tracks: [...index.tracks],
  };
  const touched = new Map<string, SyncMutation>();
  const conflicts: R2ExportConflict[] = [];
  let appliedCount = 0;

  for (const mutation of mutations) {
    const touchedKeys = mutationTouchedKeys(mutation);
    if (touchedKeys.length === 0) continue;
    const overlappingKey = touchedKeys.find((key) => touched.has(key));
    if (overlappingKey) {
      const previous = touched.get(overlappingKey);
      if (previous)
        conflicts.push(mutationConflict(index.set.id, overlappingKey, previous, mutation));
      continue;
    }
    if (!applySetMutation(folded, mutation)) continue;
    for (const key of touchedKeys) touched.set(key, mutation);
    appliedCount += 1;
    folded.set.updatedAt = Math.max(folded.set.updatedAt, mutation.createdAt);
  }

  if (appliedCount === 0) return { index, conflicts };
  folded.revision = (index.revision ?? 0) + appliedCount;
  return { index: folded, conflicts };
}

function mutationConflict(
  setId: string,
  key: string,
  previous: SyncMutation,
  current: SyncMutation,
): R2ExportConflict {
  const [entityType, fieldOrId] = key.split(":");
  if (entityType === "set") {
    return {
      setId,
      entityType,
      entityId: setId,
      field: fieldOrId,
      reason: "overlapping-mutations",
      mutationIds: [previous.id, current.id],
    };
  }

  return {
    setId,
    entityType: entityType === "memory" ? "memory" : "track",
    entityId: fieldOrId ?? setId,
    reason: "overlapping-mutations",
    mutationIds: [previous.id, current.id],
  };
}

function mutationTouchedKeys(mutation: SyncMutation): string[] {
  if (mutation.action === "set-metadata-updated") {
    const payload = mutation.payload;
    if (!isRecord(payload)) return [];
    return ["name", "description", "seedPrompt", "displayMode", "config"]
      .filter((field) => Object.hasOwn(payload, field))
      .map((field) => `set:${field}`);
  }

  if (mutation.action === "track-added-to-set") {
    const track = trackPayload(mutation.payload);
    return track ? [`track:${track.id}`] : [];
  }

  if (mutation.action === "track-removed-from-set") {
    const trackId = trackIdPayload(mutation.payload);
    return trackId ? [`track:${trackId}`] : [];
  }

  if (mutation.action === "memory-added") {
    const memory = memoryPayload(mutation.payload);
    return memory ? [`memory:${memory.id}`] : [];
  }

  return [];
}

function applySetMutation(index: R2SetIndex, mutation: SyncMutation): boolean {
  if (mutation.action === "set-metadata-updated") {
    const payload = mutation.payload;
    if (!isRecord(payload)) return false;
    if (typeof payload.name === "string" && payload.name.trim()) index.set.name = payload.name;
    if (typeof payload.description === "string") index.set.description = payload.description;
    if (typeof payload.seedPrompt === "string") index.set.seedPrompt = payload.seedPrompt;
    if (payload.displayMode === "video" || payload.displayMode === "cover") {
      index.set.displayMode = payload.displayMode;
    }
    if (isRecord(payload.config)) {
      const config = r2DjConfigSchema.partial().safeParse(payload.config);
      if (config.success) index.set.config = { ...index.set.config, ...config.data };
    }
    return true;
  }

  if (mutation.action === "track-added-to-set") {
    const track = trackPayload(mutation.payload);
    if (!track || index.tracks.some((existing) => existing.id === track.id)) return false;
    const position = trackPositionPayload(mutation.payload);
    index.tracks.splice(position ?? index.tracks.length, 0, track);
    return true;
  }

  if (mutation.action === "track-removed-from-set") {
    const trackId = trackIdPayload(mutation.payload);
    if (!trackId) return false;
    const nextTracks = index.tracks.filter((track) => track.id !== trackId);
    if (nextTracks.length === index.tracks.length) return false;
    index.tracks = nextTracks;
    return true;
  }

  if (mutation.action === "memory-added") {
    const trackId = trackIdPayload(mutation.payload);
    const memory = memoryPayload(mutation.payload);
    if (!trackId || !memory) return false;
    const track = index.tracks.find((candidate) => candidate.id === trackId);
    if (!track || track.memories.some((existing) => existing.id === memory.id)) return false;
    track.memories = [...track.memories, memory].sort((a, b) => a.createdAt - b.createdAt);
    return true;
  }

  return false;
}

function trackPayload(payload: unknown): R2SetIndex["tracks"][number] | undefined {
  if (!isRecord(payload)) return undefined;
  const result = r2SetTrackSchema.safeParse(payload.track);
  return result.success ? result.data : undefined;
}

function trackIdPayload(payload: unknown): string | undefined {
  return isRecord(payload) && typeof payload.trackId === "string" ? payload.trackId : undefined;
}

function memoryPayload(
  payload: unknown,
): R2SetIndex["tracks"][number]["memories"][number] | undefined {
  if (!isRecord(payload)) return undefined;
  const result = r2MemorySchema.safeParse(payload.memory);
  return result.success ? result.data : undefined;
}

function trackPositionPayload(payload: unknown): number | undefined {
  if (!isRecord(payload)) return undefined;
  return typeof payload.position === "number" && Number.isInteger(payload.position)
    ? Math.max(0, payload.position)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function setMutationKey(mutation: SyncMutation): string {
  return `sets/${mutation.entityId}/mutations/${mutation.devicePublicId}/${String(
    mutation.createdAt,
  ).padStart(13, "0")}-${mutation.id}.json`;
}

function createManifest(
  input: R2ExportPlanInput,
  setIndexes: Array<{
    session: DjSession;
    publishedId: string;
    trackCount: number;
    object: R2ExportObject;
  }>,
  indexObjects: R2ExportObject[] = [],
  selfDeviceId?: string,
): R2Manifest {
  const now = new Date().toISOString();
  const remoteManifest = input.remoteBase?.manifest?.value;
  // Discovery pointers this run didn't (re)write fall back to the remote
  // manifest's — another device's stats/presence/etc. must stay discoverable.
  const devicesIndex =
    indexObjects.find((object) => object.kind === "devices-index")?.key ??
    remoteManifest?.devicesIndex;
  const statsIndex =
    indexObjects.find((object) => object.kind === "stats-index")?.key ?? remoteManifest?.statsIndex;
  const presenceIndex =
    indexObjects.find((object) => object.kind === "presence-index")?.key ??
    remoteManifest?.presenceIndex;
  const entityCoversIndex =
    indexObjects.find((object) => object.kind === "entity-covers-index")?.key ??
    remoteManifest?.entityCoversIndex;
  const localSets = setIndexes.map(({ session, publishedId, trackCount, object }) => {
    // Co-publishing never steals ownership: a set keeps its original publisher
    // (deletion semantics hang off `publishedBy === self`, PRD §12.5).
    const remoteEntry = remoteManifest?.sets.find((set) => set.id === publishedId);
    return {
      id: publishedId,
      title: session.name,
      index: object.key,
      updatedAt: new Date(session.updatedAt).toISOString(),
      trackCount,
      bytes: object.bytes,
      publishedBy: remoteEntry?.publishedBy ?? selfDeviceId,
    };
  });
  return {
    schema: "muzero-r2-manifest-v1",
    libraryId: input.libraryId,
    title: "MUZERO Library",
    createdAt: remoteManifest?.createdAt ?? now,
    updatedAt: now,
    baseUrl: input.baseUrl,
    devicesIndex,
    statsIndex,
    presenceIndex,
    entityCoversIndex,
    sets: mergeManifestSets(remoteManifest?.sets ?? [], localSets, selfDeviceId),
  };
}

/**
 * Precondition for the root manifest write (PRD §12.4): with a fetched base, an
 * existing object writes with `If-Match` only when the base has a strong ETag,
 * and an absent one guards the first write with `If-None-Match: *`. No base
 * (legacy callers) → unconditional. Weak ETags (`W/"..."`) cannot satisfy
 * `If-Match`, so using them would create a guaranteed 412 loop.
 */
function basePrecondition(
  remoteBase: RemotePublishBase | undefined,
  baseObject: RemoteBaseObject<unknown> | undefined,
): R2ObjectWritePrecondition | undefined {
  if (!remoteBase) return undefined;
  if (!baseObject) return { ifNoneMatch: "*" };
  return writeIfMatchPrecondition(baseObject.etag);
}

function childPrecondition(
  remoteBase: RemotePublishBase | undefined,
  baseObject: RemoteBaseObject<unknown> | undefined,
): R2ObjectWritePrecondition | undefined {
  if (!remoteBase || !baseObject) return undefined;
  return writeIfMatchPrecondition(baseObject.etag);
}

function writeIfMatchPrecondition(etag: string | undefined): R2ObjectWritePrecondition | undefined {
  const strongEtag = strongIfMatchEtag(etag);
  return strongEtag ? { ifMatch: strongEtag } : undefined;
}

function sanitizeWritePrecondition(
  precondition: R2ObjectWritePrecondition | undefined,
): R2ObjectWritePrecondition | undefined {
  if (!precondition) return undefined;
  const ifMatch = strongIfMatchEtag(precondition.ifMatch);
  const sanitized = {
    ...(ifMatch ? { ifMatch } : {}),
    ...(precondition.ifNoneMatch ? { ifNoneMatch: precondition.ifNoneMatch } : {}),
  };
  return sanitized.ifMatch || sanitized.ifNoneMatch ? sanitized : undefined;
}

function strongIfMatchEtag(etag: string | undefined): string | undefined {
  const trimmed = etag?.trim();
  if (!trimmed || /^W\//i.test(trimmed)) return undefined;
  return trimmed;
}

async function createDeviceObjects(
  db: MuzeroDB,
  playbackEventFlush?: R2PlaybackEventFlushOptions,
  deviceExport: R2DeviceExportOptions = {},
  remoteBase?: RemotePublishBase,
  mediaStorage?: MediaBlobStorageOptions,
): Promise<R2ExportObject[]> {
  const device = await db.devices.get("dev_local");
  if (!device) return [];

  const objects: R2ExportObject[] = [];
  let checkpointKey: string | undefined;
  let latestSegmentKey: string | undefined;
  let statsUpdatedAt = 0;
  const shouldPublishProfile = (deviceExport.publishProfile ?? true) && device.publishProfile;
  const shouldPublishStats = deviceExport.publishStats ?? true;
  const shouldPublishPresence = deviceExport.publishPresence ?? false;
  const avatar =
    shouldPublishProfile && device.avatarBlobId
      ? await loadOptionalBinaryObject("device-avatar", device.avatarBlobId, db, {}, mediaStorage)
      : undefined;
  if (avatar) objects.push(avatar.object);

  if (shouldPublishProfile) {
    objects.push(
      await createJsonObject(
        "device-profile",
        `profiles/devices/${device.publicId}/profile.json`,
        toDevicePublicProfile(device, avatar?.remote),
        { precondition: deviceExport.profilePrecondition },
      ),
    );
  }

  const aggregates = await db.playbackAggregates
    .where("devicePublicId")
    .equals(device.publicId)
    .toArray();
  if (shouldPublishStats && aggregates.length > 0) {
    statsUpdatedAt = Math.max(
      statsUpdatedAt,
      ...aggregates.map((aggregate) => aggregate.updatedAt),
    );
    objects.push(
      await createJsonObject(
        "stats-aggregate",
        `stats/devices/${device.publicId}/aggregate.json`,
        toStatsAggregateObject(device.publicId, aggregates),
      ),
    );
  }

  const events = await db.playbackEvents
    .where("devicePublicId")
    .equals(device.publicId)
    .sortBy("startedAt");
  if (shouldPublishStats && shouldExportPlaybackEvents(events, playbackEventFlush)) {
    const segment = toPlaybackEventsSegment(device.publicId, events);
    const segmentKey = await playbackEventsSegmentKey(device.publicId, segment);
    latestSegmentKey = segmentKey;
    checkpointKey = `stats/devices/${device.publicId}/checkpoint.json`;
    statsUpdatedAt = Math.max(statsUpdatedAt, segment.updatedAt);
    objects.push(
      await createJsonObject("stats-events-segment", segmentKey, segment),
      await createJsonObject(
        "stats-checkpoint",
        checkpointKey,
        toPlaybackEventsCheckpoint(device.publicId, events, segmentKey),
      ),
    );
  }

  if (shouldPublishProfile) {
    const localDevicesIndex: R2DevicesIndex = {
      schema: "muzero-r2-devices-v1",
      updatedAt: device.lastSeenAt,
      devices: [
        {
          publicId: device.publicId,
          displayName: device.name,
          avatarSeed: device.avatarSeed,
          profile: `profiles/devices/${device.publicId}/profile.json`,
          stats: `stats/devices/${device.publicId}/aggregate.json`,
          lastSeenAt: device.lastSeenAt,
          profileUpdatedAt: device.lastSeenAt,
        },
      ],
    };
    objects.push(
      await createJsonObject(
        "devices-index",
        "devices/index.json",
        mergeDevicesIndex(remoteBase?.devicesIndex?.value, localDevicesIndex),
        { precondition: childPrecondition(remoteBase, remoteBase?.devicesIndex) },
      ),
    );
  }

  if (shouldPublishStats && (aggregates.length > 0 || checkpointKey || latestSegmentKey)) {
    const localStatsIndex: R2StatsIndex = {
      schema: "muzero-r2-stats-index-v1",
      updatedAt: statsUpdatedAt,
      devices: [
        {
          devicePublicId: device.publicId,
          aggregate:
            aggregates.length > 0 ? `stats/devices/${device.publicId}/aggregate.json` : undefined,
          checkpoint: checkpointKey,
          latestSegment: latestSegmentKey,
          updatedAt: statsUpdatedAt,
        },
      ],
    };
    objects.push(
      await createJsonObject(
        "stats-index",
        "stats/index.json",
        mergeStatsIndex(remoteBase?.statsIndex?.value, localStatsIndex),
        { precondition: childPrecondition(remoteBase, remoteBase?.statsIndex) },
      ),
    );
  }

  if (shouldPublishPresence) {
    const localPresenceIndex: R2PresenceIndex = {
      schema: "muzero-r2-presence-index-v1",
      updatedAt: device.lastSeenAt,
      devices: [
        {
          devicePublicId: device.publicId,
          presence: `presence/devices/${device.publicId}.json`,
          updatedAt: device.lastSeenAt,
        },
      ],
    };
    objects.push(
      await createJsonObject(
        "presence-index",
        "presence/index.json",
        mergePresenceIndex(remoteBase?.presenceIndex?.value, localPresenceIndex),
        { precondition: childPrecondition(remoteBase, remoteBase?.presenceIndex) },
      ),
    );
  }

  return objects;
}

function shouldExportPlaybackEvents(
  events: PlaybackEvent[],
  flush: R2PlaybackEventFlushOptions | undefined,
): boolean {
  return shouldFlushPlaybackEventSegment({
    events,
    mode: flush?.mode ?? "manual",
    now: flush?.now ?? Date.now(),
    eventThreshold: flush?.eventThreshold,
    maxAgeMs: flush?.maxAgeMs,
  });
}

function toDevicePublicProfile(device: DeviceRecord, avatar?: R2RemoteObject): DevicePublicProfile {
  return {
    schema: "muzero-r2-device-profile-v1",
    devicePublicId: device.publicId,
    displayName: device.name,
    avatarSeed: device.avatarSeed,
    avatar,
    appVersion: device.appVersion,
    revision: device.profileRevision,
    updatedAt: device.lastSeenAt,
  };
}

function toStatsAggregateObject(devicePublicId: string, aggregates: PlaybackAggregate[]) {
  return {
    schema: "muzero-r2-playback-aggregate-v1",
    devicePublicId,
    updatedAt: Math.max(...aggregates.map((aggregate) => aggregate.updatedAt)),
    aggregates: aggregates.map((aggregate) => ({
      id: aggregate.id,
      scope: aggregate.scope,
      driveId: aggregate.driveId,
      shareId: aggregate.shareId,
      setId: aggregate.setId,
      trackId: aggregate.trackId,
      remoteTrackId: aggregate.remoteTrackId,
      mediaSha256: aggregate.mediaSha256,
      playCount: aggregate.playCount,
      listenedSec: aggregate.listenedSec,
      lastPlayedAt: aggregate.lastPlayedAt,
      updatedAt: aggregate.updatedAt,
    })),
  };
}

function toPlaybackEventsSegment(devicePublicId: string, events: PlaybackEvent[]) {
  return {
    schema: "muzero-r2-playback-events-segment-v1",
    devicePublicId,
    startedAt: events[0]?.startedAt ?? 0,
    endedAt: events.at(-1)?.startedAt ?? 0,
    updatedAt: Math.max(...events.map((event) => event.endedAt ?? event.startedAt)),
    eventCount: events.length,
    events: events.map((event) => ({
      id: event.id,
      trackId: event.trackId,
      remoteTrackRef: event.remoteTrackRef,
      context: event.context,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
      listenedSec: event.listenedSec,
      countedAsPlay: event.countedAsPlay,
    })),
  };
}

function toPlaybackEventsCheckpoint(
  devicePublicId: string,
  events: PlaybackEvent[],
  segmentKey: string,
) {
  const last = events.at(-1);
  return {
    schema: "muzero-r2-playback-checkpoint-v1",
    devicePublicId,
    updatedAt: last?.endedAt ?? last?.startedAt ?? 0,
    lastEventId: last?.id,
    lastStartedAt: last?.startedAt ?? 0,
    eventCount: events.length,
    segment: segmentKey,
  };
}

async function playbackEventsSegmentKey(
  devicePublicId: string,
  segment: ReturnType<typeof toPlaybackEventsSegment>,
): Promise<string> {
  const hash = await sha256Text(JSON.stringify(segment));
  return `stats/events/${devicePublicId}/${segment.startedAt}-${segment.endedAt}-${hash.slice(
    0,
    16,
  )}.json`;
}

async function sha256Blob(blob: MediaBlob): Promise<string> {
  const value = blob.blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  const bytes =
    typeof value.arrayBuffer === "function"
      ? new Uint8Array(await value.arrayBuffer())
      : new TextEncoder().encode(`${blob.id}:${blob.mime}:${blob.bytes}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function binaryDirectory(
  kind: "media" | "cover" | "memory-photo" | "device-avatar" | "entity-cover",
): string {
  if (kind === "media") return "objects/media";
  // Entity covers share the content-addressed cover directory (deduped by hash).
  if (kind === "cover" || kind === "entity-cover") return "objects/covers";
  if (kind === "device-avatar") return "objects/avatars";
  return "objects/memories";
}

function extensionForMime(mime: string): string {
  if (mime === "audio/mpeg") return ".mp3";
  if (mime === "audio/wav" || mime === "audio/wave" || mime === "audio/x-wav") return ".wav";
  if (mime === "video/mp4") return ".mp4";
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return "";
}

import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/id";
import type {
  AppSettings,
  ChatSession,
  CloudDrive,
  CloudShare,
  DeviceRecord,
  DjSession,
  EntityCover,
  MediaBlob,
  Memory,
  PlaybackAggregate,
  PlaybackEvent,
  PlayQueue,
  PlayQueueEntry,
  RemoteSearchCatalog,
  RemoteSearchSet,
  RemoteSearchTrack,
  SyncMutation,
  SyncObject,
  SyncRun,
  Track,
  TrackPlaybackStats,
} from "./types";

/**
 * MUZERO's on-device store. Everything lives here — tracks, media blobs (audio /
 * video / cover images), sets, settings. No backend, no cloud. The DB name
 * `muzero-db` is a stable codename and must not change across UI/brand tweaks.
 */
export class MuzeroDB extends Dexie {
  tracks!: EntityTable<Track, "id">;
  mediaBlobs!: EntityTable<MediaBlob, "id">;
  sessions!: EntityTable<DjSession, "id">;
  settings!: EntityTable<AppSettings, "id">;
  playQueue!: EntityTable<PlayQueue, "id">;
  memories!: EntityTable<Memory, "id">;
  chatSessions!: EntityTable<ChatSession, "id">;
  remoteSearchCatalogs!: EntityTable<RemoteSearchCatalog, "id">;
  remoteSearchTracks!: EntityTable<RemoteSearchTrack, "id">;
  remoteSearchSets!: EntityTable<RemoteSearchSet, "id">;
  cloudDrives!: EntityTable<CloudDrive, "id">;
  cloudShares!: EntityTable<CloudShare, "id">;
  syncRuns!: EntityTable<SyncRun, "id">;
  syncObjects!: EntityTable<SyncObject, "id">;
  syncMutations!: EntityTable<SyncMutation, "id">;
  devices!: EntityTable<DeviceRecord, "id">;
  trackPlaybackStats!: EntityTable<TrackPlaybackStats, "id">;
  playbackEvents!: EntityTable<PlaybackEvent, "id">;
  playbackAggregates!: EntityTable<PlaybackAggregate, "id">;
  entityCovers!: EntityTable<EntityCover, "id">;

  constructor(name = "muzero-db") {
    super(name);

    // v1 — original AI-DJ-only schema.
    this.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });

    // v2 — annotations (*tags), mixed audio/video tracks (kind), media-blob roles
    // (media vs cover), and set display modes. Backfills existing rows.
    this.version(2)
      .stores({
        tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
        mediaBlobs: "id, trackId, role",
        sessions: "id, status, updatedAt",
        settings: "id",
      })
      .upgrade(async (tx) => {
        await tx
          .table("tracks")
          .toCollection()
          .modify((t: Partial<Track>) => {
            t.kind ??= "audio";
            t.origin ??= "generated";
            t.tags ??= [];
          });
        await tx
          .table("mediaBlobs")
          .toCollection()
          .modify((b: Partial<MediaBlob>) => {
            b.role ??= "media";
          });
        await tx
          .table("sessions")
          .toCollection()
          .modify((s: Partial<DjSession>) => {
            s.displayMode ??= "video";
            if (s.config) s.config.autoExtend ??= true;
          });
      });

    // v3 — split 播放列表(Play Queue) from 歌单(Set). New `playQueue` singleton the
    // player consumes; seed it from the persisted resume point so playback
    // continues seamlessly after the decoupling. (Memory table arrives in a later
    // version.) Only the new table is declared — Dexie inherits the rest.
    this.version(3)
      .stores({ playQueue: "id" })
      .upgrade(async (tx) => {
        const settings = (await tx.table("settings").get("app")) as
          | Partial<AppSettings>
          | undefined;
        let entries: PlayQueueEntry[] = [];
        let currentIndex = -1;
        let contextSetId: string | undefined;
        if (settings?.lastSessionId) {
          const session = (await tx.table("sessions").get(settings.lastSessionId)) as
            | DjSession
            | undefined;
          if (session && session.trackIds.length > 0) {
            entries = session.trackIds.map((trackId) => ({ id: newId("pqe"), trackId }));
            currentIndex = Math.min(Math.max(0, settings.lastTrackIndex ?? 0), entries.length - 1);
            contextSetId = session.id;
          }
        }
        await tx.table("playQueue").put({
          id: "main",
          entries,
          currentIndex,
          repeat: "off",
          contextSetId,
          updatedAt: Date.now(),
        } satisfies PlayQueue);
      });

    // v4 — 歌曲记忆 Memory (one-to-many). New `memories` table; photos reuse
    // `mediaBlobs` with the additive role "memory" (no blob-index change needed).
    // Backfill: each track's single deprecated `note` becomes its first Memory,
    // preserving the recollection. The `Track.note` field stays (nullable,
    // deprecated) for defense; new annotations write memories instead.
    this.version(4)
      .stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" })
      .upgrade(async (tx) => {
        const tracks = (await tx.table("tracks").toArray()) as Track[];
        for (const t of tracks) {
          const note = t.note?.trim();
          if (note) {
            await tx.table("memories").add({
              id: newId("mem"),
              trackId: t.id,
              note,
              createdAt: t.createdAt,
            } satisfies Memory);
          }
        }
      });

    // v5 — AI DJ chat sessions. Messages are stored as one JSON snapshot per
    // session so streaming persistence remains local and simple.
    this.version(5).stores({ chatSessions: "id, updatedAt" });

    // v6 — stage display mode is now only video-or-cover. Older rows that used
    // the title-only mode should behave like cover mode and still fall back to
    // the title/visualizer when no cover exists.
    this.version(6).upgrade(async (tx) => {
      await tx
        .table("sessions")
        .toCollection()
        .modify((s: Partial<DjSession>) => {
          const legacy = s as Record<string, unknown>;
          if (legacy.displayMode === "title") legacy.displayMode = "cover";
        });
    });

    // v7 — the previous default Now-Playing background renderer was the Pixi/WebGL
    // noise effect. Because `saveSettings()` persists a fully merged settings row,
    // many users got `backgroundRenderer: "noise"` without explicitly choosing it.
    // WKWebView can flash while restoring that full-screen WebGL layer at launch,
    // so existing rows are moved back to the stable image renderer once.
    this.version(7).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          if (s.backgroundRenderer === "noise") s.backgroundRenderer = "image";
        });
    });

    // v8 — full-screen background visualizers are still available as a visible
    // setting, but they should not be inherited as the launch default. Existing
    // settings rows that only got `true` from the previous default are moved to
    // the stable image/slideshow background path.
    this.version(8).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          if (s.visualizerAsBackground === true) {
            s.visualizerAsBackground = false;
            s.visualizerIdleOnly = false;
          }
        });
    });

    // v9 — keep the selected visualizer style, but disable its full-screen
    // background placement for existing settings rows. This keeps launch on the
    // stable image/slideshow path unless the user opts in again.
    this.version(9).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          s.visualizerAsBackground = false;
          s.visualizerIdleOnly = false;
        });
    });

    // v10 — stop carrying legacy boot-resume pointers forward. The app no longer
    // auto-cues previous media during WKWebView startup because that path can make
    // the Now Playing background flicker for existing local databases.
    this.version(10).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          delete s.lastSessionId;
          delete s.lastTrackIndex;
        });
    });

    // v11 — remote R2 search catalog cache. These rows are metadata-only and
    // point at streamable remote objects; media bytes still stay out of IndexedDB
    // unless a later cache/offline action downloads them into `mediaBlobs`.
    this.version(11).stores({
      remoteSearchCatalogs: "id, scope, syncedAt, updatedAt",
      remoteSearchTracks: "id, catalogId, trackId, *setIds, *shareIds, *tags, updatedAt",
      remoteSearchSets: "id, catalogId, setId, updatedAt",
    });

    // v12 — local cloud drive/share registry. This stores public metadata and
    // capability flags; raw R2 write credentials stay in local settings only.
    this.version(12).stores({
      cloudDrives: "id, kind, provider, updatedAt, lastSyncedAt",
      cloudShares: "id, driveId, remoteShareId, access, lastSyncedAt",
    });

    // v13 — sync bookkeeping for visible progress, resumability, and object
    // provenance. The object id is `${driveId}:${key}`.
    this.version(13).stores({
      syncRuns: "id, driveId, direction, status, startedAt",
      syncObjects: "id, driveId, key, kind, sourceSetId, sourceTrackId, updatedAt, lastUploadedAt",
    });

    // v14 — anonymous local device identity and per-device playback stats.
    this.version(14).stores({
      devices: "id, publicId, lastSeenAt",
      trackPlaybackStats: "id, trackId, devicePublicId, updatedAt, [trackId+devicePublicId]",
      playbackEvents: "id, devicePublicId, startedAt, trackId, [devicePublicId+startedAt]",
      playbackAggregates: "id, devicePublicId, scope, driveId, shareId, setId, trackId, updatedAt",
    });

    // v15 — local edit mutation log for remote diff, auto-merge, and conflict
    // detection. Unsynced rows are scoped per drive and anonymous device id.
    this.version(15).stores({
      syncMutations: "id, driveId, devicePublicId, scope, entityId, createdAt, syncedAt",
    });

    // v16 — memory author snapshots. Existing local memories predate anonymous
    // device attribution, so mark them as unknown local snapshots instead of
    // guessing which device/person wrote them.
    this.version(16).upgrade(async (tx) => {
      await tx
        .table("memories")
        .toCollection()
        .modify((memory: Partial<Memory>) => {
          memory.author ??= {
            devicePublicId: "unknown-local",
            displayName: "Unknown local device",
          };
        });
    });

    // v17 — normalized media metadata for uploaded/generated tracks. This is
    // optional, small JSON on Track; media bytes and covers still live in
    // `mediaBlobs`, so no indexes or hot-list query shape change.
    this.version(17).upgrade(async (tx) => {
      const blobs = (await tx.table("mediaBlobs").toArray()) as MediaBlob[];
      const mediaByTrackId = new Map(
        blobs.filter((blob) => blob.role === "media").map((blob) => [blob.trackId, blob]),
      );
      await tx
        .table("tracks")
        .toCollection()
        .modify((track: Partial<Track>) => {
          if (track.mediaMetadata) return;
          const media = track.id ? mediaByTrackId.get(track.id) : undefined;
          track.mediaMetadata = {
            title: track.title,
            originalMime: media?.mime,
            parser: track.origin === "generated" ? "track-brief" : "manual",
            parsedAt: track.createdAt ?? Date.now(),
          };
        });
    });

    // v18 — local-folder import provenance. `sourcePath` records the absolute
    // on-disk path a track was imported from, so re-syncing a remembered folder
    // skips files already in the library. Additive + indexed; pre-v18 uploaded
    // tracks simply lack it (they were never folder-sourced, so no collision),
    // and the sparse index just omits them — no `.upgrade()` backfill needed.
    this.version(18).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind, sourcePath",
    });

    // v19 — user-chosen covers for DERIVED artist/album entities. The row id IS
    // the entity projection key (normalized artist name / album key); bytes reuse
    // `mediaBlobs` (role "cover", trackId = key). Additive new table, no backfill.
    this.version(19).stores({
      entityCovers: "id, kind, updatedAt",
    });
  }
}

/** The app-wide singleton. Tests construct their own `MuzeroDB(uniqueName)`. */
export const db = new MuzeroDB();

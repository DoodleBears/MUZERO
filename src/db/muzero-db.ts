import Dexie, { type EntityTable } from "dexie";
import { newId } from "@/lib/id";
import { likeRowsFromLegacyTracks } from "./track-likes";
import type {
  AppSettings,
  ChatSession,
  CloudDrive,
  CloudShare,
  CoverDerivative,
  CustomLlmProvider,
  DeviceRecord,
  DjSession,
  DownloadJob,
  EntityCover,
  MediaBlob,
  Memory,
  PlaybackAggregate,
  PlaybackCacheEntry,
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
  TrackEnrichment,
  TrackLike,
  TrackLyrics,
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
  trackLikes!: EntityTable<TrackLike, "trackId">;
  playbackEvents!: EntityTable<PlaybackEvent, "id">;
  playbackAggregates!: EntityTable<PlaybackAggregate, "id">;
  entityCovers!: EntityTable<EntityCover, "id">;
  lyrics!: EntityTable<TrackLyrics, "id">;
  llmCustomProviders!: EntityTable<CustomLlmProvider, "id">;
  playbackCache!: EntityTable<PlaybackCacheEntry, "id">;
  coverDerivatives!: EntityTable<CoverDerivative, "id">;
  downloadJobs!: EntityTable<DownloadJob, "id">;
  enrichments!: EntityTable<TrackEnrichment, "id">;

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
          repeat: "all",
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

    // v20 — auto-fetched / manual lyrics (synced-lyrics PRD). Separate table so
    // KB-scale LRC text never rides the virtualized track-list query (rule 6).
    // 1:1 with a track via the unique `trackId`. Additive new table, no backfill.
    this.version(20).stores({
      lyrics: "id, &trackId",
    });

    // v21 — user-defined OpenAI-compatible LLM providers (chat PRD §6.1,
    // ClipCombo parity). Additive new table, no backfill; keys stay in the
    // settings row, never here.
    this.version(21).stores({
      llmCustomProviders: "id, createdAt",
    });

    // v22 — bounded LRU playback cache for remote media bytes. Unlike
    // `mediaBlobs`/`Track.blobId`, this is not a user-requested offline download;
    // it may be evicted when the size limit is exceeded.
    this.version(22).stores({
      playbackCache: "id, sourceUrl, trackId, lastAccessedAt",
    });

    // v23 — the default Now Playing visual stack is live again: flow + spectrum
    // together. Older settings rows often carry `visualizerAsBackground: false`
    // from v8/v9 downgrade migrations, while new flow defaults merge in as true,
    // which leaves users seeing only flow. Move existing rows onto the current
    // visible default; users can still turn either layer off in Settings.
    this.version(23).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          s.visualizerAsBackground = true;
          s.flowEnabled ??= true;
        });
    });

    // v24 — playlist repeat defaults to full-queue looping. Older settings rows
    // often carry `playerRepeatMode: "off"` because `saveSettings()` persists a
    // fully merged defaults object, so move inherited old defaults to the current
    // visible default. Existing repeat-one / repeat-all choices are preserved.
    this.version(24).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          if (s.playerRepeatMode === "off") s.playerRepeatMode = "all";
        });
      await tx
        .table("playQueue")
        .toCollection()
        .modify((q: Partial<PlayQueue>) => {
          if (q.repeat === "off") q.repeat = "all";
        });
    });

    // v25 — cover derivative registry. Generated thumbnails/backlight/stage
    // images are keyed by cover source + crop + algorithm version so hot Track
    // rows do not churn when caches are generated or repaired.
    this.version(25).stores({
      coverDerivatives: "id, sourceKey, kind, blobId, generatedAt, [sourceKey+kind]",
    });

    // v26 — move the high-churn `liked` bit OFF the cold `tracks` catalog row into a
    // dedicated side table (mirrors `trackPlaybackStats` for playCount). Toggling a
    // like used to `tracks.update(id,{liked})` → re-fire EVERY tracks liveQuery (the
    // play-queue's getTracksByIds(N) + search全表 listAllTracks), tanking FPS on big
    // queues. Now it writes `trackLikes` only. The one-time upgrade backfills existing
    // liked tracks; `tracks.liked` stays as a deprecated compatibility field
    // (double-read transition). PRD 20260617-scalable-track-list.
    this.version(26)
      .stores({ trackLikes: "trackId, likedAt" })
      .upgrade(async (tx) => {
        const tracks = await tx.table("tracks").toArray();
        const rows = likeRowsFromLegacyTracks(tracks, Date.now());
        if (rows.length > 0) await tx.table("trackLikes").bulkAdd(rows);
      });

    // v27 — lyrics motion now defaults to the cascade layout. Older settings rows
    // often carry `lyricsMotionMode: "classic"` because `saveSettings()` persists
    // fully merged defaults, so move inherited old defaults to the current visible
    // default. Existing inertial / cascade choices are preserved.
    this.version(27).upgrade(async (tx) => {
      await tx
        .table("settings")
        .toCollection()
        .modify((s: Partial<AppSettings>) => {
          if (s.lyricsMotionMode === "classic") s.lyricsMotionMode = "cascade";
        });
    });

    // v28 — remove the obsolete `tracks.liked` INDEX. Likes have lived in the
    // `trackLikes` side table since v26, so keeping an index on the deprecated
    // catalog field only adds write amplification during large local-folder imports.
    // The field itself remains on rows for R2/export compatibility; only the index
    // is dropped.
    this.version(28).stores({
      tracks: "id, sessionId, status, createdAt, *tags, kind, sourcePath",
    });

    // v29 — remove the unused local `tracks.*tags` multiEntry INDEX. Tag search
    // and tag counts scan the loaded track rows (`track.tags`) in memory, and no
    // runtime path queries Dexie by this index. Keeping it costs extra index work
    // on every imported row, especially large local-folder bulkAdd batches.
    // The `tags` field remains on each row.
    this.version(29).stores({
      tracks: "id, sessionId, status, createdAt, kind, sourcePath",
    });

    // v30 — trim the remaining unused local track indexes. Runtime Dexie queries
    // only need `sessionId` (per-set reads / streamed-track dedupe) and `sourcePath`
    // (folder-sync dedupe / local-media repair). `status`, `createdAt`, and `kind`
    // are still row fields, but no product path queries tracks by those indexes.
    this.version(30).stores({
      tracks: "id, sessionId, sourcePath",
    });

    // v31 — persistent download queue (download-queue-resume-autosync PRD). The queue
    // runner pulls by `status` (pending/active) frequently, so it IS indexed (unlike the
    // memory-filtered streamed-track queries). Additive new table, no backfill.
    this.version(31).stores({
      downloadJobs: "id, status, createdAt",
    });

    // v32 — external genre/style enrichment (genre-enrichment PRD). Own table, mirroring
    // `lyrics` (v20): NOT on the Track row so a first-play enrichment write can't fan out
    // the virtualized queue/list liveQueries. 1:1 via a unique trackId. Additive, no backfill.
    this.version(32).stores({
      enrichments: "id, &trackId",
    });
  }
}

/** The app-wide singleton. Tests construct their own `MuzeroDB(uniqueName)`. */
export const db = new MuzeroDB();

import { z } from "zod";
import { trackBriefSchema } from "@/dj/dj-brief-schema";
import { LYRICS_SOURCES } from "@/lyrics/provider";

const timestampStringSchema = z.string().min(1);
const millisSchema = z.number().int().nonnegative();
const remotePathSchema = z.string().min(1);

export const r2RemoteObjectSchema = z.object({
  key: remotePathSchema.optional(),
  url: remotePathSchema,
  mime: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().min(1).optional(),
});

export const r2SetSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  index: remotePathSchema,
  updatedAt: timestampStringSchema,
  trackCount: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
  // Which device published this set (additive, multi-writer phase). Lets a
  // read-merge-write publish keep OTHER devices' sets in the manifest while
  // staying authoritative for its own (including deletions). Legacy manifests
  // omit it — those sets are preserved conservatively.
  publishedBy: z.string().min(1).optional(),
});

export const r2ManifestSchema = z.object({
  schema: z.literal("muzero-r2-manifest-v1"),
  libraryId: z.string().min(1),
  title: z.string().min(1),
  createdAt: timestampStringSchema,
  updatedAt: timestampStringSchema,
  baseUrl: z.string().url(),
  sets: z.array(r2SetSummarySchema),
  devicesIndex: remotePathSchema.optional(),
  statsIndex: remotePathSchema.optional(),
  presenceIndex: remotePathSchema.optional(),
  // Library-global (not set-scoped): custom covers for derived artist/album
  // entities. Points at `library/entity-covers/index.json`.
  entityCoversIndex: remotePathSchema.optional(),
});

const r2CropSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

/** One artist/album custom cover in the library-global entity-covers index. */
export const r2EntityCoverEntrySchema = z.object({
  id: z.string().min(1), // entity projection key (normalizeArtistName / AlbumEntry.key)
  kind: z.enum(["artist", "album"]),
  cover: r2RemoteObjectSchema,
  crop: r2CropSchema.optional(),
  // Base64 thumbhash — instant blurred preview for a remote-only cover before its
  // bytes download (instant-cover-thumbnails PRD §3.4).
  thumbhash: z.string().optional(),
  updatedAt: millisSchema, // last-write-wins clock
});

export const r2EntityCoversIndexSchema = z.object({
  schema: z.literal("muzero-r2-entity-covers-v1"),
  updatedAt: millisSchema,
  entries: z.array(r2EntityCoverEntrySchema),
});

export const r2DjConfigSchema = z.object({
  autoExtend: z.boolean(),
  refillThreshold: z.number().int().nonnegative(),
  batchSize: z.number().int().positive(),
  targetDurationSec: z.number().int().positive(),
  allowVocals: z.boolean(),
});

export const r2SetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  seedPrompt: z.string(),
  displayMode: z.enum(["video", "cover", "title"]),
  config: r2DjConfigSchema,
  createdAt: millisSchema,
  updatedAt: millisSchema,
});

export const r2MemoryAuthorSchema = z.object({
  devicePublicId: z.string().min(1),
  displayName: z.string().optional(),
  avatarSeed: z.string().optional(),
  avatarUrl: remotePathSchema.optional(),
});

export const r2MemorySchema = z.object({
  id: z.string().min(1),
  note: z.string(),
  author: r2MemoryAuthorSchema.optional(),
  createdAt: millisSchema,
  // Optional playback anchor (seconds) — additive, omitted by older manifests.
  atSec: z.number().nonnegative().optional(),
  photo: r2RemoteObjectSchema.optional(),
});

export const r2TrackMediaMetadataSchema = z.object({
  title: z.string().optional(),
  artists: z.array(z.string()).optional(),
  album: z.string().optional(),
  albumArtists: z.array(z.string()).optional(),
  genres: z.array(z.string()).optional(),
  year: z.number().int().optional(),
  date: z.string().optional(),
  trackNo: z.number().int().positive().optional(),
  trackOf: z.number().int().positive().optional(),
  diskNo: z.number().int().positive().optional(),
  diskOf: z.number().int().positive().optional(),
  composer: z.array(z.string()).optional(),
  bpm: z.number().optional(),
  key: z.string().optional(),
  isrc: z.array(z.string()).optional(),
  musicBrainzRecordingId: z.string().optional(),
  musicBrainzTrackId: z.string().optional(),
  musicBrainzAlbumId: z.string().optional(),
  musicBrainzArtistIds: z.array(z.string()).optional(),
  originalFileName: z.string().optional(),
  originalMime: z.string().optional(),
  originalExtension: z.string().optional(),
  container: z.string().optional(),
  codec: z.string().optional(),
  bitrate: z.number().optional(),
  sampleRate: z.number().int().positive().optional(),
  numberOfChannels: z.number().int().positive().optional(),
  parser: z.enum(["music-metadata", "track-brief", "manual"]),
  parsedAt: millisSchema,
});

// Synced/plain lyrics carried in the manifest (synced-lyrics PRD §4.8). Only the
// content + provenance travel; `status`/`fetchedAt` are reconstructed on import.
const r2LyricsSchema = z.object({
  synced: z.string().optional(),
  plain: z.string().optional(),
  instrumental: z.boolean().default(false),
  // Reuse the canonical LyricsSource list so the manifest enum can never drift
  // narrower than the union (the `"amll"` provider was added later). Additive —
  // still a free string slot, no manifest version bump (rule #4).
  source: z.enum(LYRICS_SOURCES),
  sourceId: z.string().optional(),
});

const r2StreamMetaSchema = z.object({
  artist: z.string().optional(),
  album: z.string().optional(),
  coverUrl: z.string().url().optional(),
  durationSec: z.number().nonnegative().optional(),
});

export const r2SetTrackSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    kind: z.enum(["audio", "video"]),
    // Streamed tracks publish their source ref + display snapshot. If the device
    // has cached media bytes, those bytes are private-drive content and publish
    // as the optional media object too.
    origin: z.enum(["generated", "uploaded", "streamed"]),
    provider: z.string().min(1),
    durationSec: z.number().nonnegative(),
    createdAt: millisSchema,
    generatedAt: millisSchema.nullable().optional(),
    liked: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    mediaMetadata: r2TrackMediaMetadataSchema.optional(),
    brief: trackBriefSchema.nullable().optional(),
    providerPreset: z.string().nullable().optional(),
    streamSourceId: z.enum(["netease", "bili", "youtube"]).optional(),
    streamExternalId: z.string().min(1).optional(),
    streamMeta: r2StreamMetaSchema.optional(),
    // 歌单内分数序 rank（drag-reorder PRD §4.2）。Additive optional → 无 manifest 版本
    // bump（同 thumbhash / lyrics 的 carry）。导出端把 tracks[] 按 rank 排序并逐首带上
    // rank；import 端据此重建 trackRanks。legacy manifest 省略 → 回落到数组顺序。
    rank: z.number().optional(),
    media: r2RemoteObjectSchema.optional(),
    cover: r2RemoteObjectSchema.optional(),
    // Non-destructive square crop for the cover, in the original image's pixels —
    // additive optional (audit F11), so a cropped cover renders the same framing
    // on the subscribing device.
    coverCrop: r2CropSchema.optional(),
    // Base64 thumbhash of the cover — instant preview for a not-yet-downloaded
    // remote track cover (instant-cover-thumbnails PRD §3.4).
    thumbhash: z.string().optional(),
    // Synced/plain lyrics (LRCLIB or manual) — additive optional field, mirrors the
    // thumbhash carry: no manifest version bump (synced-lyrics PRD §4.8).
    lyrics: r2LyricsSchema.optional(),
    memories: z.array(r2MemorySchema).default([]),
  })
  .superRefine((track, ctx) => {
    if (track.origin !== "streamed" && !track.media) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["media"],
        message: "generated/uploaded tracks must include media",
      });
    }
  });

// Removal tombstone for multi-device co-editing (PRD §12.5): a removed member's
// published id + when. Additive optional — legacy indexes omit it. Without these,
// a stale copy on another device would resurrect removed tracks at merge time.
export const r2RemovedTrackSchema = z.object({
  id: z.string().min(1),
  removedAt: millisSchema,
});

export const r2SetIndexSchema = z.object({
  schema: z.literal("muzero-r2-set-index-v1"),
  revision: z.number().int().nonnegative().optional(),
  set: r2SetSchema,
  tracks: z.array(r2SetTrackSchema),
  removedTracks: z.array(r2RemovedTrackSchema).optional(),
});

export const r2ShareManifestSchema = z.object({
  schema: z.literal("muzero-r2-share-manifest-v1"),
  shareId: z.string().min(1),
  title: z.string().min(1),
  createdAt: timestampStringSchema,
  updatedAt: timestampStringSchema,
  baseUrl: z.string().url(),
  sourceSetId: z.string().min(1),
  index: remotePathSchema,
  capabilities: z.object({
    readMedia: z.boolean(),
    readMemories: z.boolean(),
    writeStats: z.boolean(),
    writePresence: z.boolean(),
  }),
});

export const r2PlaybackAggregateSchema = z.object({
  scope: z.enum(["track", "track-in-set", "track-in-share", "set", "share", "drive"]),
  driveId: z.string().optional(),
  shareId: z.string().optional(),
  setId: z.string().optional(),
  trackId: z.string().optional(),
  remoteTrackId: z.string().optional(),
  mediaSha256: z.string().optional(),
  playCount: z.number().int().nonnegative(),
  listenedSec: z.number().nonnegative(),
  lastPlayedAt: millisSchema.optional(),
  updatedAt: millisSchema,
});

export const r2StatsSchema = z.object({
  schema: z.literal("muzero-r2-stats-v1"),
  devicePublicId: z.string().min(1),
  revision: z.number().int().nonnegative(),
  updatedAt: millisSchema,
  aggregates: z.array(r2PlaybackAggregateSchema),
});

// Owner-maintained discovery indexes, formalized for the multi-writer
// read-merge-write publish (each writing device upserts its own entry and
// preserves the others'). Shapes match what export planning always wrote.
export const r2DeviceIndexEntrySchema = z.object({
  publicId: z.string().min(1),
  displayName: z.string().optional(),
  avatarSeed: z.string().optional(),
  profile: remotePathSchema.optional(),
  stats: remotePathSchema.optional(),
  lastSeenAt: millisSchema.optional(),
  profileUpdatedAt: millisSchema.optional(),
});

export const r2DevicesIndexSchema = z.object({
  schema: z.literal("muzero-r2-devices-v1"),
  updatedAt: millisSchema,
  devices: z.array(r2DeviceIndexEntrySchema),
});

export const r2StatsIndexDeviceSchema = z.object({
  devicePublicId: z.string().min(1),
  aggregate: remotePathSchema.optional(),
  checkpoint: remotePathSchema.optional(),
  latestSegment: remotePathSchema.optional(),
  updatedAt: millisSchema,
});

export const r2StatsIndexSchema = z.object({
  schema: z.literal("muzero-r2-stats-index-v1"),
  updatedAt: millisSchema,
  devices: z.array(r2StatsIndexDeviceSchema),
});

export const r2PresenceIndexSchema = z.object({
  schema: z.literal("muzero-r2-presence-index-v1"),
  updatedAt: millisSchema,
  devices: z.array(
    z.object({
      devicePublicId: z.string().min(1),
      presence: remotePathSchema,
      updatedAt: millisSchema,
    }),
  ),
});

export const r2DevicePublicProfileSchema = z.object({
  schema: z.literal("muzero-r2-device-profile-v1"),
  devicePublicId: z.string().min(1),
  displayName: z.string().min(1),
  avatarSeed: z.string().optional(),
  avatar: r2RemoteObjectSchema.optional(),
  appVersion: z.string().optional(),
  revision: z.number().int().nonnegative(),
  updatedAt: millisSchema,
});

export type R2Manifest = z.infer<typeof r2ManifestSchema>;
export type R2SetSummary = z.infer<typeof r2SetSummarySchema>;
export type R2DevicePublicProfile = z.infer<typeof r2DevicePublicProfileSchema>;
export type R2DevicesIndex = z.infer<typeof r2DevicesIndexSchema>;
export type R2StatsIndex = z.infer<typeof r2StatsIndexSchema>;
export type R2EntityCoverEntry = z.infer<typeof r2EntityCoverEntrySchema>;
export type R2EntityCoversIndex = z.infer<typeof r2EntityCoversIndexSchema>;
export type R2SetIndex = z.infer<typeof r2SetIndexSchema>;
export type R2ShareManifest = z.infer<typeof r2ShareManifestSchema>;
export type R2Stats = z.infer<typeof r2StatsSchema>;
export type R2PresenceIndex = z.infer<typeof r2PresenceIndexSchema>;

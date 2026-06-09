import { z } from "zod";
import { trackBriefSchema } from "@/dj/dj-brief-schema";

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

export const r2SetTrackSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(["audio", "video"]),
  origin: z.enum(["generated", "uploaded"]),
  provider: z.string().min(1),
  durationSec: z.number().nonnegative(),
  createdAt: millisSchema,
  generatedAt: millisSchema.nullable().optional(),
  liked: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  mediaMetadata: r2TrackMediaMetadataSchema.optional(),
  brief: trackBriefSchema.nullable().optional(),
  providerPreset: z.string().nullable().optional(),
  media: r2RemoteObjectSchema,
  cover: r2RemoteObjectSchema.optional(),
  memories: z.array(r2MemorySchema).default([]),
});

export const r2SetIndexSchema = z.object({
  schema: z.literal("muzero-r2-set-index-v1"),
  revision: z.number().int().nonnegative().optional(),
  set: r2SetSchema,
  tracks: z.array(r2SetTrackSchema),
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

export type R2Manifest = z.infer<typeof r2ManifestSchema>;
export type R2EntityCoverEntry = z.infer<typeof r2EntityCoverEntrySchema>;
export type R2EntityCoversIndex = z.infer<typeof r2EntityCoversIndexSchema>;
export type R2SetIndex = z.infer<typeof r2SetIndexSchema>;
export type R2ShareManifest = z.infer<typeof r2ShareManifestSchema>;
export type R2Stats = z.infer<typeof r2StatsSchema>;
export type R2PresenceIndex = z.infer<typeof r2PresenceIndexSchema>;

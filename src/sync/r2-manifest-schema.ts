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

export type R2Manifest = z.infer<typeof r2ManifestSchema>;
export type R2SetIndex = z.infer<typeof r2SetIndexSchema>;
export type R2ShareManifest = z.infer<typeof r2ShareManifestSchema>;
export type R2Stats = z.infer<typeof r2StatsSchema>;

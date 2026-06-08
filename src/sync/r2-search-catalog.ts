import { z } from "zod";
import type { TrackKind, TrackOrigin } from "@/db/types";

const remotePathSchema = z.string().min(1);
const remotePageRefSchema = z.union([
  remotePathSchema,
  z.object({
    path: remotePathSchema,
    updatedAt: z.string().min(1).optional(),
    etag: z.string().min(1).optional(),
    sha256: z.string().min(1).optional(),
  }),
]);
const timestampStringSchema = z.string().min(1);
const millisSchema = z.number().int().nonnegative();

export const r2SearchCatalogSchema = z.object({
  schema: z.literal("muzero-r2-search-catalog-v1"),
  libraryId: z.string().min(1),
  updatedAt: timestampStringSchema,
  locale: z.string().min(1),
  pages: z.object({
    sets: z.array(remotePageRefSchema),
    tracks: z.array(remotePageRefSchema),
    shares: z.array(remotePageRefSchema),
  }),
  counts: z.object({
    sets: z.number().int().nonnegative(),
    tracks: z.number().int().nonnegative(),
    shares: z.number().int().nonnegative(),
  }),
});

export const r2TrackSearchRecordSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  setIds: z.array(z.string()),
  shareIds: z.array(z.string()),
  kind: z.enum(["audio", "video"]),
  origin: z.enum(["generated", "uploaded"]),
  durationSec: z.number().nonnegative(),
  tags: z.array(z.string()),
  memoryText: z.string().nullable(),
  briefCaption: z.string().nullable(),
  artistLike: z.string().nullable(),
  updatedAt: millisSchema,
  mediaAvailable: z.boolean(),
  coverUrl: remotePathSchema.optional(),
});

export const r2TrackSearchPageSchema = z.object({
  schema: z.literal("muzero-r2-track-search-page-v1"),
  page: z.number().int().positive(),
  updatedAt: timestampStringSchema,
  tracks: z.array(r2TrackSearchRecordSchema),
});

export const r2SetSearchRecordSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  trackCount: z.number().int().nonnegative(),
  coverUrl: remotePathSchema.optional(),
  updatedAt: millisSchema,
});

export const r2SetSearchPageSchema = z.object({
  schema: z.literal("muzero-r2-set-search-page-v1"),
  page: z.number().int().positive(),
  updatedAt: timestampStringSchema,
  sets: z.array(r2SetSearchRecordSchema),
});

export type R2SearchCatalog = z.infer<typeof r2SearchCatalogSchema>;
export type R2SearchPageRef = z.infer<typeof remotePageRefSchema>;
export type R2TrackSearchRecord = z.infer<typeof r2TrackSearchRecordSchema>;
export type R2TrackSearchPage = z.infer<typeof r2TrackSearchPageSchema>;
export type R2SetSearchRecord = z.infer<typeof r2SetSearchRecordSchema>;
export type R2SetSearchPage = z.infer<typeof r2SetSearchPageSchema>;

export interface RemoteSearchTrackRow {
  id: string;
  catalogId: string;
  driveId: string;
  shareId?: string;
  trackId: string;
  title: string;
  normalizedText: string;
  setIds: string[];
  shareIds: string[];
  tags: string[];
  kind: TrackKind;
  origin: TrackOrigin;
  durationSec: number;
  coverUrl?: string;
  mediaAvailable: boolean;
  updatedAt: number;
}

export interface RemoteSearchTrackToRowInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  track: R2TrackSearchRecord;
}

export interface RemoteSearchSetRow {
  id: string;
  catalogId: string;
  driveId: string;
  shareId?: string;
  setId: string;
  name: string;
  description?: string;
  normalizedText: string;
  trackCount: number;
  coverUrl?: string;
  updatedAt: number;
}

export interface RemoteSearchSetToRowInput {
  catalogId: string;
  driveId: string;
  shareId?: string;
  set: R2SetSearchRecord;
}

function normalizeSearchText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .toLowerCase();
}

export function remoteSearchTrackToRow(input: RemoteSearchTrackToRowInput): RemoteSearchTrackRow {
  const { catalogId, driveId, shareId, track } = input;
  return {
    id: `${catalogId}:${track.id}`,
    catalogId,
    driveId,
    shareId,
    trackId: track.id,
    title: track.title,
    normalizedText: normalizeSearchText([
      track.title,
      track.tags.join(" "),
      track.memoryText,
      track.briefCaption,
      track.artistLike,
    ]),
    setIds: track.setIds,
    shareIds: track.shareIds,
    tags: track.tags.map((tag) => tag.toLowerCase()),
    kind: track.kind,
    origin: track.origin,
    durationSec: track.durationSec,
    coverUrl: track.coverUrl,
    mediaAvailable: track.mediaAvailable,
    updatedAt: track.updatedAt,
  };
}

export function remoteSearchSetToRow(input: RemoteSearchSetToRowInput): RemoteSearchSetRow {
  const { catalogId, driveId, shareId, set } = input;
  return {
    id: `${catalogId}:${set.id}`,
    catalogId,
    driveId,
    shareId,
    setId: set.id,
    name: set.name,
    description: set.description,
    normalizedText: normalizeSearchText([set.name, set.description]),
    trackCount: set.trackCount,
    coverUrl: set.coverUrl,
    updatedAt: set.updatedAt,
  };
}

export function matchesRemoteSearchTrack(row: RemoteSearchTrackRow, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((token) => {
    if (token.startsWith("#") && token.length > 1) {
      const tag = token.slice(1);
      return row.tags.some((candidate) => candidate.includes(tag));
    }
    return row.normalizedText.includes(token);
  });
}

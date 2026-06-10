import { z } from "zod";
import type { TrackKind, TrackMediaMetadata, TrackOrigin } from "@/db/types";
import { type IndexableRow, isEmptyTokens, parseSearchTokens, scoreRow } from "@/lib/search-core";
import { NO_MATCH_SCORE } from "@/lib/search-transliterate";
import { r2TrackMediaMetadataSchema } from "./r2-manifest-schema";

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
  origin: z.enum(["generated", "uploaded", "streamed"]),
  durationSec: z.number().nonnegative(),
  tags: z.array(z.string()),
  mediaMetadata: r2TrackMediaMetadataSchema.optional(),
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
  mediaMetadata?: TrackMediaMetadata;
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
      track.mediaMetadata?.title,
      track.mediaMetadata?.artists?.join(" "),
      track.mediaMetadata?.albumArtists?.join(" "),
      track.mediaMetadata?.album,
      track.mediaMetadata?.genres?.join(" "),
      track.mediaMetadata?.year?.toString(),
    ]),
    setIds: track.setIds,
    shareIds: track.shareIds,
    tags: track.tags.map((tag) => tag.toLowerCase()),
    mediaMetadata: track.mediaMetadata,
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

/**
 * Map a synced remote row to the source-agnostic searchable shape, so cross-drive
 * search shares the local matcher (incl. pinyin/romaji). `normalizedText` (which
 * folds memory/caption/artist-like text) rides along as a free field so its CJK
 * content is reachable phonetically too; the structured fields are kept separate
 * for clean per-field transliteration.
 */
export function remoteRowToIndexable(row: RemoteSearchTrackRow): IndexableRow {
  const m = row.mediaMetadata;
  const artistText = [...(m?.artists ?? []), ...(m?.albumArtists ?? [])].join(" ");
  return {
    id: row.id,
    free: [
      row.normalizedText,
      row.title,
      m?.title ?? "",
      artistText,
      m?.album ?? "",
      m?.genres?.join(" ") ?? "",
      ...row.tags,
    ].filter((s) => s.length > 0),
    artist: [artistText].filter((s) => s.length > 0),
    album: [m?.album ?? ""].filter((s) => s.length > 0),
    tags: row.tags,
  };
}

export function matchesRemoteSearchTrack(row: RemoteSearchTrackRow, query: string): boolean {
  // Same scoped grammar (artist:/album:/#tag + free) and transliteration as the
  // local matcher, so cross-drive search behaves identically.
  const tokens = parseSearchTokens(query);
  if (isEmptyTokens(tokens)) return true;
  return scoreRow(remoteRowToIndexable(row), tokens) < NO_MATCH_SCORE;
}

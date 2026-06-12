import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type {
  CloudSourceAttribution,
  DjSession,
  EntityCover,
  Memory,
  SetDisplayMode,
  Track,
  TrackLyrics,
} from "@/db/types";
import { coverPaletteFromThumbhash, normalizeCoverPalette } from "@/lib/cover-palette";
import { newId } from "@/lib/id";
import type { LyricsSource } from "@/lyrics/provider";
import { RANK_SPACING } from "@/player/set-order";
import type { R2EntityCoversIndex } from "./r2-manifest-schema";
import type { RemoteSetIndexResult } from "./r2-subscription";
import { resolveRemoteObjectUrl } from "./r2-url";

export interface ImportRemoteSetStreamInput {
  driveId: string;
  shareId?: string;
  remoteSet: RemoteSetIndexResult;
  source?: CloudSourceAttribution;
}

export interface ImportRemoteSetStreamResult {
  sessionId: string;
  trackIds: string[];
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function remoteLocalId(prefix: "ses" | "trk" | "mem", driveId: string, remoteId: string): string {
  return `${prefix}_remote_${safeIdPart(driveId)}_${safeIdPart(remoteId)}`;
}

function remoteTrackIdPrefix(driveId: string): string {
  return `trk_remote_${safeIdPart(driveId)}_`;
}

/**
 * The id an entity publishes under on its source drive (PRD §12.5): a
 * `…_remote_<driveId>_…` local id maps back to the ORIGINAL remote id; any
 * other id (this device's own entity) publishes as-is.
 */
export function publishedEntityId(
  prefix: "ses" | "trk" | "mem",
  driveId: string,
  localId: string,
): string {
  const remotePrefix = `${prefix}_remote_${safeIdPart(driveId)}_`;
  return localId.startsWith(remotePrefix) ? localId.slice(remotePrefix.length) : localId;
}

function mergeRemoteAndLocalOnlyTrackIds(
  remoteTrackIds: string[],
  existingTrackIds: string[] | undefined,
  driveId: string,
): string[] {
  if (!existingTrackIds || existingTrackIds.length === 0) return remoteTrackIds;
  const remoteIds = new Set(remoteTrackIds);
  const remotePrefix = remoteTrackIdPrefix(driveId);
  const localOnlyIds = existingTrackIds.filter(
    (trackId) => !trackId.startsWith(remotePrefix) && !remoteIds.has(trackId),
  );
  return [...remoteTrackIds, ...localOnlyIds];
}

/**
 * Rebuild the fractional-order ranks from a remote set index (drag-reorder PRD §4.2).
 * Restores each remote track's `rank`; any local-only members (merged in, absent from
 * the remote) are ranked after the max so the invariant — trackRanks covers every
 * member — holds. Returns undefined for a legacy manifest with no ranks (the set then
 * orders by the tracks[] array, which the exporter already emits in display order).
 */
function reconstructTrackRanks(
  remoteTracks: RemoteSetIndexResult["tracks"],
  driveId: string,
  mergedTrackIds: string[],
): Record<string, number> | undefined {
  const ranks: Record<string, number> = {};
  let anyRank = false;
  for (const rt of remoteTracks) {
    if (typeof rt.source.rank === "number") {
      ranks[remoteLocalId("trk", driveId, rt.id)] = rt.source.rank;
      anyRank = true;
    }
  }
  if (!anyRank) return undefined;
  const localOnly = mergedTrackIds.filter((id) => !(id in ranks));
  if (localOnly.length > 0) {
    const max = Math.max(...Object.values(ranks));
    localOnly.forEach((id, i) => {
      ranks[id] = max + (i + 1) * RANK_SPACING;
    });
  }
  return ranks;
}

function normalizeDisplayMode(
  mode: RemoteSetIndexResult["index"]["set"]["displayMode"],
): SetDisplayMode {
  return mode === "title" ? "cover" : mode;
}

export function sanitizeCloudSource(source: CloudSourceAttribution): CloudSourceAttribution {
  return {
    driveId: source.driveId,
    driveLabel: source.driveLabel?.trim() || undefined,
    devicePublicId: source.devicePublicId?.trim() || undefined,
    displayName: source.displayName?.trim() || undefined,
    avatarSeed: source.avatarSeed?.trim() || undefined,
    avatarUrl: source.avatarUrl?.trim() || undefined,
  };
}

export async function importRemoteSetStream(
  input: ImportRemoteSetStreamInput,
  db: MuzeroDB = defaultDb,
): Promise<ImportRemoteSetStreamResult> {
  const { driveId, remoteSet } = input;
  const sessionId = remoteLocalId("ses", driveId, remoteSet.index.set.id);
  const remoteTrackIds = remoteSet.tracks.map((track) => remoteLocalId("trk", driveId, track.id));
  const existingSession = await db.sessions.get(sessionId);
  const trackIds = mergeRemoteAndLocalOnlyTrackIds(
    remoteTrackIds,
    existingSession?.trackIds,
    driveId,
  );
  const trackRanks = reconstructTrackRanks(remoteSet.tracks, driveId, trackIds);
  const session: DjSession = {
    id: sessionId,
    name: remoteSet.index.set.name,
    description: remoteSet.index.set.description,
    seedPrompt: remoteSet.index.set.seedPrompt,
    trackIds,
    trackRanks,
    status: "idle",
    config: remoteSet.index.set.config,
    displayMode: normalizeDisplayMode(remoteSet.index.set.displayMode),
    coverBlobId: existingSession?.coverBlobId,
    coverCrop: existingSession?.coverBlobId
      ? existingSession.coverCrop
      : (remoteSet.index.set.coverCrop ?? existingSession?.coverCrop),
    coverThumbhash: existingSession?.coverBlobId
      ? existingSession.coverThumbhash
      : (remoteSet.index.set.thumbhash ?? existingSession?.coverThumbhash),
    remoteCoverUrl: existingSession?.coverBlobId
      ? existingSession.remoteCoverUrl
      : (remoteSet.setCoverUrl ?? existingSession?.remoteCoverUrl),
    cloudSource: input.source ? sanitizeCloudSource(input.source) : existingSession?.cloudSource,
    createdAt: remoteSet.index.set.createdAt,
    updatedAt: remoteSet.index.set.updatedAt,
  };

  // Field-level merge for rows that already exist locally (audit F1): the remote
  // index is authoritative for CONTENT (title/brief/media URLs/metadata), but a
  // re-import must never clobber LOCAL state — cached media (`blobId`), the local
  // custom cover (+crop), annotation edits (liked/tags/note), play counts, or the
  // local annotation clock. Without per-field clocks this is a simple local-wins
  // rule; first imports still take the remote values verbatim.
  const existingTracks = new Map(
    (await db.tracks.bulkGet(remoteTrackIds))
      .filter((track): track is Track => Boolean(track))
      .map((track) => [track.id, track]),
  );
  const tracks: Track[] = remoteSet.tracks.map((remoteTrack) => {
    const id = remoteLocalId("trk", driveId, remoteTrack.id);
    const existing = existingTracks.get(id);
    const remoteCoverUrl = remoteTrack.coverUrl ?? remoteTrack.source.streamMeta?.coverUrl;
    const remoteCoverThumbhash = existing?.coverThumbhash ?? remoteTrack.source.thumbhash;
    const remoteCoverPalette = normalizeCoverPalette(remoteTrack.source.coverPalette);
    const existingPaletteMatches =
      existing?.coverPaletteSource === remoteCoverUrl ||
      (!existing?.coverPaletteSource && existing?.remoteCoverUrl === remoteCoverUrl);
    const fallbackCoverPalette = coverPaletteFromThumbhash(remoteCoverThumbhash);
    const importedCoverPalette =
      remoteCoverPalette.length > 0
        ? remoteCoverPalette
        : existingPaletteMatches && existing?.coverPalette?.length
          ? existing.coverPalette
          : fallbackCoverPalette;
    return {
      id,
      sessionId,
      title: remoteTrack.source.title,
      kind: remoteTrack.source.kind,
      origin: remoteTrack.source.origin,
      brief: remoteTrack.source.brief ?? undefined,
      provider: remoteTrack.source.provider,
      providerPreset: remoteTrack.source.providerPreset ?? undefined,
      streamSourceId: remoteTrack.source.streamSourceId,
      streamExternalId: remoteTrack.source.streamExternalId,
      streamMeta: remoteTrack.source.streamMeta,
      status: "ready",
      durationSec: remoteTrack.source.durationSec,
      remoteMediaUrl: remoteTrack.mediaUrl,
      remoteCoverUrl,
      coverThumbhash: remoteCoverThumbhash ?? undefined,
      coverPalette: existing?.coverBlobId
        ? existing.coverPalette
        : importedCoverPalette.length > 0
          ? importedCoverPalette
          : undefined,
      coverPaletteSource: existing?.coverBlobId
        ? existing.coverPaletteSource
        : importedCoverPalette.length > 0
          ? remoteCoverUrl
          : undefined,
      createdAt: remoteTrack.source.createdAt,
      updatedAt: existing?.updatedAt ?? remoteTrack.source.createdAt,
      generatedAt: remoteTrack.source.generatedAt ?? undefined,
      blobId: existing?.blobId,
      coverBlobId: existing?.coverBlobId,
      // A local crop edit wins; otherwise the published crop travels (F11).
      coverCrop: existing?.coverCrop ?? remoteTrack.source.coverCrop,
      note: existing?.note,
      playCount: existing?.playCount ?? 0,
      liked: existing?.liked ?? remoteTrack.source.liked,
      tags: existing?.tags ?? remoteTrack.source.tags,
      mediaMetadata: remoteTrack.source.mediaMetadata,
      cloudSource: input.source ? sanitizeCloudSource(input.source) : existing?.cloudSource,
    };
  });

  const memories: Memory[] = remoteSet.tracks.flatMap((remoteTrack) => {
    const trackId = remoteLocalId("trk", driveId, remoteTrack.id);
    return (remoteTrack.source.memories ?? []).map((memory) => ({
      id: remoteLocalId("mem", driveId, memory.id),
      trackId,
      note: memory.note,
      author: memory.author,
      remotePhotoUrl: remoteTrack.memoryPhotoUrls.find((photo) => photo.memoryId === memory.id)
        ?.url,
      createdAt: memory.createdAt,
      atSec: memory.atSec,
    }));
  });

  // Lyrics carried in the manifest land in the lyrics table, honoring the
  // manual-wins merge (synced-lyrics PRD §4.8).
  const lyricsRows: TrackLyrics[] = [];
  for (const remoteTrack of remoteSet.tracks) {
    const src = remoteTrack.source.lyrics;
    if (!src) continue;
    const trackId = remoteLocalId("trk", driveId, remoteTrack.id);
    const existing = await db.lyrics.where("trackId").equals(trackId).first();
    if (!lyricsRemoteWins(existing, src)) continue;
    lyricsRows.push({
      id: existing?.id ?? newId("lyr"),
      trackId,
      source: src.source,
      sourceId: src.sourceId,
      synced: src.synced,
      plain: src.plain,
      instrumental: src.instrumental,
      status: src.instrumental ? "instrumental" : "found",
      fetchedAt: existing?.fetchedAt ?? remoteTrack.source.createdAt,
    });
  }

  await db.transaction("rw", db.sessions, db.tracks, db.memories, db.lyrics, async () => {
    await db.sessions.put(session);
    await db.tracks.bulkPut(tracks);
    if (memories.length > 0) await db.memories.bulkPut(memories);
    if (lyricsRows.length > 0) await db.lyrics.bulkPut(lyricsRows);
  });

  return { sessionId, trackIds: remoteTrackIds };
}

/**
 * Last-write-wins for an entity cover: the remote wins when there's no local
 * cover or the remote clock is strictly newer. A tie keeps the local (the bytes
 * are content-addressed, so a same-clock cover is the same image).
 */
export function entityCoverRemoteWins(
  localUpdatedAt: number | undefined,
  remoteUpdatedAt: number,
): boolean {
  return localUpdatedAt == null || remoteUpdatedAt > localUpdatedAt;
}

/**
 * Last-write-wins for lyrics: a local *manual* record is never clobbered by a
 * remote *auto* (lrclib) one; otherwise the published remote version wins. The
 * manifest carries no fetchedAt, so same-source recency can't be compared — the
 * published catalog is authoritative. (synced-lyrics PRD §4.8.)
 */
export function lyricsRemoteWins(
  local: { source: LyricsSource } | undefined,
  remote: { source: LyricsSource },
): boolean {
  if (local?.source === "manual" && remote.source !== "manual") return false;
  return true;
}

export interface ImportRemoteEntityCoversInput {
  baseUrl: string;
  index: R2EntityCoversIndex;
}

/**
 * Import the library-global entity-cover index from R2 into local `entityCovers`,
 * resolving each to a remote-backed row (display URL + re-export reference, no
 * local bytes — mirrors how remote track covers store `remoteCoverUrl`). LWW per
 * entity: a strictly-newer LOCAL cover is kept; an older local is replaced and its
 * blob cleaned up. (Tombstone/clear propagation is deferred — see the PRD.)
 */
export async function importRemoteEntityCovers(
  input: ImportRemoteEntityCoversInput,
  db: MuzeroDB = defaultDb,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;
  await db.transaction("rw", db.entityCovers, db.mediaBlobs, async () => {
    for (const entry of input.index.entries) {
      const local = await db.entityCovers.get(entry.id);
      if (!entityCoverRemoteWins(local?.updatedAt, entry.updatedAt)) {
        skipped += 1;
        continue;
      }
      if (local?.coverBlobId) await db.mediaBlobs.delete(local.coverBlobId);
      const row: EntityCover = {
        id: entry.id,
        kind: entry.kind,
        remoteCover: {
          url: resolveRemoteObjectUrl(input.baseUrl, entry.cover.url),
          key: entry.cover.url,
          mime: entry.cover.mime,
          bytes: entry.cover.bytes,
          sha256: entry.cover.sha256,
        },
        crop: entry.crop,
        thumbhash: entry.thumbhash,
        updatedAt: entry.updatedAt,
      };
      await db.entityCovers.put(row);
      imported += 1;
    }
  });
  return { imported, skipped };
}

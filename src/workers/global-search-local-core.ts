import type { Memory, Track, TrackPlaybackStats } from "@/db/types";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";
import { buildAlbumIndex, buildArtistIndex } from "@/lib/library-index";
import { queryRows } from "@/lib/search-core";
import { searchEntityFacetsLimited, trackToRow } from "@/lib/track-search";

export interface GlobalSearchLocalInput {
  includeAlbums: boolean;
  includeArtists: boolean;
  includeTracks: boolean;
  query: string;
  resultLimit: number;
  /**
   * LOCAL media-kind filter (`@Video` / `@Audio`). Narrows the songs list to
   * `Track.kind === mediaKind`. Applied during the in-memory `readyTracks` pass —
   * BEFORE `slice(resultLimit)` — so the top-N never gets short-changed by a
   * post-filter (see the scope-media-filters PRD §5.3). No Dexie index: the worker
   * already loads every row, so this is a free predicate on the existing pass.
   */
  mediaKind?: "audio" | "video";
  /** Folded in by the local worker / inline fallback; callers do not need to post this. */
  trackPlaybackStats?: readonly TrackPlaybackStats[];
}

export interface GlobalSearchLocalResults {
  albums: AlbumEntry[];
  artists: ArtistEntry[];
  coverTrackIds: string[];
  trackIds: string[];
}

export function buildGlobalSearchLocalResults(
  tracks: Track[],
  memories: Memory[],
  input: GlobalSearchLocalInput,
): GlobalSearchLocalResults {
  const query = input.query.trim();
  const resultLimit = Math.max(1, input.resultLimit);
  const lastPlayedAtByTrackId = lastPlayedByTrack(input.trackPlaybackStats ?? []);
  const readyTracks = input.includeTracks
    ? tracks
        .filter(
          (track) =>
            track.status === "ready" && (!input.mediaKind || track.kind === input.mediaKind),
        )
        .sort(
          (a, b) =>
            trackActivityAt(b, lastPlayedAtByTrackId) - trackActivityAt(a, lastPlayedAtByTrackId),
        )
    : [];
  const memoryNotes = input.includeTracks
    ? memoryNotesByTrack(memories)
    : new Map<string, string[]>();
  const trackIds = input.includeTracks
    ? query
      ? queryRows(
          readyTracks.map((track) => trackToRow(track, memoryNotes.get(track.id) ?? [])),
          query,
        )
          .slice(0, resultLimit)
          .map((hit) => hit.id)
      : readyTracks.slice(0, resultLimit).map((track) => track.id)
    : [];

  const artistIndex = input.includeArtists ? buildArtistIndex(tracks) : [];
  const albumIndex = input.includeAlbums ? buildAlbumIndex(tracks) : [];
  const facets = query
    ? searchEntityFacetsLimited(artistIndex, albumIndex, query, resultLimit)
    : { albums: [], artists: [] };
  const albums = input.includeAlbums
    ? (query ? facets.albums : albumIndex.filter((entry) => !entry.bucket)).slice(0, resultLimit)
    : [];
  const artists = input.includeArtists
    ? (query ? facets.artists : artistIndex.filter((entry) => !entry.bucket)).slice(0, resultLimit)
    : [];
  const coverTrackIds = uniqueDefined([
    ...albums.map((entry) => entry.coverTrackId),
    ...artists.map((entry) => entry.coverTrackId),
  ]);

  return { albums, artists, coverTrackIds, trackIds };
}

function lastPlayedByTrack(stats: readonly TrackPlaybackStats[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of stats) {
    if (row.lastPlayedAt == null) continue;
    map.set(row.trackId, Math.max(map.get(row.trackId) ?? 0, row.lastPlayedAt));
  }
  return map;
}

function trackActivityAt(track: Track, lastPlayedAtByTrackId: ReadonlyMap<string, number>): number {
  return lastPlayedAtByTrackId.get(track.id) ?? track.updatedAt ?? track.createdAt;
}

function memoryNotesByTrack(memories: Memory[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const memory of memories.sort((a, b) => a.createdAt - b.createdAt)) {
    if (!memory.note.trim()) continue;
    const list = map.get(memory.trackId);
    if (list) list.push(memory.note);
    else map.set(memory.trackId, [memory.note]);
  }
  return map;
}

function uniqueDefined(values: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

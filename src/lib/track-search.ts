import type { Track } from "@/db/types";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";

/**
 * Pure track search over annotations + metadata. "Music carries memories", so
 * the track's memories and tags are first-class search surfaces alongside
 * title/caption. All query tokens must match (AND).
 *
 * Tokens are field-scoped, extending the original `#tag` convention:
 *   - `#tag`     → matches tags only
 *   - `artist:x` → matches the artist / album-artist fields only
 *   - `album:x`  → matches the album field only
 *   - bare       → case-insensitive substring against any field
 *
 * Memories live in their own table, so callers pass the track's memory notes in
 * (e.g. from `memoryNotesByTrack`); the legacy `track.note` is still folded in
 * for any not-yet-migrated row.
 */
export function trackSearchText(track: Track, memoryNotes: readonly string[] = []): string {
  const metadata = track.mediaMetadata;
  return [
    track.title,
    metadata?.title,
    metadata?.artists?.join(" "),
    metadata?.albumArtists?.join(" "),
    metadata?.album,
    metadata?.genres?.join(" "),
    metadata?.year?.toString(),
    metadata?.date,
    metadata?.composer?.join(" "),
    metadata?.isrc?.join(" "),
    metadata?.musicBrainzRecordingId,
    metadata?.musicBrainzTrackId,
    track.brief?.caption ?? "",
    track.note ?? "",
    track.tags.join(" "),
    track.provider,
    memoryNotes.join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

/** Field-scoped query tokens, all lowercased. */
export interface SearchTokens {
  /** Bare substring tokens, matched against any field. */
  free: string[];
  /** `artist:` tokens, matched against the artist / album-artist fields. */
  artist: string[];
  /** `album:` tokens, matched against the album field. */
  album: string[];
  /** `#tag` tokens, matched against tags only. */
  tags: string[];
}

/** Split a query into field-scoped tokens (`artist:`/`album:`/`#tag`) + free text. */
export function parseSearchTokens(query: string): SearchTokens {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const result: SearchTokens = { free: [], artist: [], album: [], tags: [] };
  for (const token of tokens) {
    if (token.startsWith("#") && token.length > 1) result.tags.push(token.slice(1));
    else if (token.startsWith("artist:") && token.length > 7) result.artist.push(token.slice(7));
    else if (token.startsWith("album:") && token.length > 6) result.album.push(token.slice(6));
    else result.free.push(token);
  }
  return result;
}

export function isEmptyTokens(tokens: SearchTokens): boolean {
  return (
    tokens.free.length === 0 &&
    tokens.artist.length === 0 &&
    tokens.album.length === 0 &&
    tokens.tags.length === 0
  );
}

function trackArtistText(track: Track): string {
  const metadata = track.mediaMetadata;
  return [...(metadata?.artists ?? []), ...(metadata?.albumArtists ?? [])].join(" ").toLowerCase();
}

function trackAlbumText(track: Track): string {
  return (track.mediaMetadata?.album ?? "").toLowerCase();
}

export function matchesQuery(
  track: Track,
  query: string,
  memoryNotes: readonly string[] = [],
): boolean {
  const tokens = parseSearchTokens(query);
  if (isEmptyTokens(tokens)) return true;
  const haystack = trackSearchText(track, memoryNotes);
  const artistHay = trackArtistText(track);
  const albumHay = trackAlbumText(track);
  return (
    tokens.free.every((token) => haystack.includes(token)) &&
    tokens.tags.every((tag) => track.tags.some((t) => t.includes(tag))) &&
    tokens.artist.every((token) => artistHay.includes(token)) &&
    tokens.album.every((token) => albumHay.includes(token))
  );
}

export function searchTracks(
  tracks: Track[],
  query: string,
  memoryNotesByTrackId?: ReadonlyMap<string, readonly string[]>,
): Track[] {
  if (!query.trim()) return tracks;
  return tracks.filter((t) => matchesQuery(t, query, memoryNotesByTrackId?.get(t.id) ?? []));
}

/** Tracks carrying a given tag (exact, case-insensitive). */
export function tracksWithTag(tracks: Track[], tag: string): Track[] {
  const needle = tag.trim().toLowerCase();
  return tracks.filter((t) => t.tags.includes(needle));
}

export interface EntityFacets {
  artists: ArtistEntry[];
  albums: AlbumEntry[];
}

/**
 * Match derived artist/album entities for the faceted search surface. An artist
 * matches when every artist-relevant token (free + `artist:`) is a substring of
 * its display name; an album matches when every album-relevant token (free +
 * `album:`) is a substring of "album · artist". A facet stays empty when no
 * relevant token is present (so e.g. `album:foo` surfaces only albums). Pseudo
 * buckets never appear as search hits.
 */
export function searchEntityFacets(
  artists: ArtistEntry[],
  albums: AlbumEntry[],
  query: string,
): EntityFacets {
  const { free, artist, album } = parseSearchTokens(query);
  const artistTokens = [...free, ...artist];
  const albumTokens = [...free, ...album];
  const matchedArtists =
    artistTokens.length === 0
      ? []
      : artists.filter(
          (entry) =>
            !entry.bucket &&
            artistTokens.every((token) => entry.name.toLowerCase().includes(token)),
        );
  const matchedAlbums =
    albumTokens.length === 0
      ? []
      : albums.filter((entry) => {
          if (entry.bucket) return false;
          const hay = `${entry.name} ${entry.artistName ?? ""}`.toLowerCase();
          return albumTokens.every((token) => hay.includes(token));
        });
  return { artists: matchedArtists, albums: matchedAlbums };
}

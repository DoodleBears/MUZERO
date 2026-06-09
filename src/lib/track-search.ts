import type { Track } from "@/db/types";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";
import { NO_MATCH_SCORE, scoreVariants, searchVariants } from "@/lib/search-transliterate";

/**
 * Pure track search over annotations + metadata. "Music carries memories", so
 * the track's memories and tags are first-class search surfaces alongside
 * title/caption. All query tokens must match (AND).
 *
 * Matching runs through the transliteration engine ([`search-transliterate`]),
 * so CJK fields are reachable by phonetic input — Chinese pinyin (full + 首字母
 * initials) and Japanese kana↔romaji — and results are ranked by a tiered score
 * (exact < prefix < substring < subsequence). Until the dictionaries load it
 * degrades to substring matching, so behavior never regresses.
 *
 * Tokens are field-scoped, extending the original `#tag` convention:
 *   - `#tag`     → matches tags only
 *   - `artist:x` → matches the artist / album-artist fields only
 *   - `album:x`  → matches the album field only
 *   - bare       → matched against any field
 *
 * Memories live in their own table, so callers pass the track's memory notes in
 * (e.g. from `memoryNotesByTrack`); the legacy `track.note` is still folded in
 * for any not-yet-migrated row.
 */
export function trackSearchFields(track: Track, memoryNotes: readonly string[] = []): string[] {
  const m = track.mediaMetadata;
  return [
    track.title,
    m?.title,
    m?.artists?.join(" "),
    m?.albumArtists?.join(" "),
    m?.album,
    m?.genres?.join(" "),
    m?.year?.toString(),
    m?.date,
    m?.composer?.join(" "),
    m?.isrc?.join(" "),
    m?.musicBrainzRecordingId,
    m?.musicBrainzTrackId,
    track.brief?.caption,
    track.note,
    ...track.tags,
    track.provider,
    ...memoryNotes,
  ].filter((s): s is string => typeof s === "string" && s.length > 0);
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
  const m = track.mediaMetadata;
  return [...(m?.artists ?? []), ...(m?.albumArtists ?? [])].join(" ");
}

function trackAlbumText(track: Track): string {
  return track.mediaMetadata?.album ?? "";
}

/** Best (lowest) score for one query token across a set of candidate fields. */
function bestTokenScore(token: string, fields: readonly string[]): number {
  const queryVariants = searchVariants(token);
  let best = NO_MATCH_SCORE;
  for (const field of fields) {
    if (!field) continue;
    const score = scoreVariants(queryVariants, searchVariants(field));
    if (score < best) best = score;
    if (best === 0) break; // can't beat exact
  }
  return best;
}

/** Sum of per-token best scores, or `NO_MATCH_SCORE` if any token is unmatched. */
function scopeScore(tokens: readonly string[], fields: readonly string[]): number {
  let total = 0;
  for (const token of tokens) {
    const best = bestTokenScore(token, fields);
    if (best >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
    total += best;
  }
  return total;
}

/**
 * Relevance score for a track against a query (lower = better). Returns 0 for an
 * empty query, `NO_MATCH_SCORE` when any token's scope has no match, otherwise
 * the summed best score (capped just below the sentinel so matches always sort
 * ahead of non-matches).
 */
export function trackSearchScore(
  track: Track,
  query: string,
  memoryNotes: readonly string[] = [],
): number {
  const tokens = parseSearchTokens(query);
  if (isEmptyTokens(tokens)) return 0;

  const free = scopeScore(tokens.free, trackSearchFields(track, memoryNotes));
  if (free >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const artist = scopeScore(tokens.artist, [trackArtistText(track)]);
  if (artist >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const album = scopeScore(tokens.album, [trackAlbumText(track)]);
  if (album >= NO_MATCH_SCORE) return NO_MATCH_SCORE;
  const tags = scopeScore(tokens.tags, track.tags);
  if (tags >= NO_MATCH_SCORE) return NO_MATCH_SCORE;

  return Math.min(free + artist + album + tags, NO_MATCH_SCORE - 1);
}

export function matchesQuery(
  track: Track,
  query: string,
  memoryNotes: readonly string[] = [],
): boolean {
  return trackSearchScore(track, query, memoryNotes) < NO_MATCH_SCORE;
}

/** Filter + rank tracks by query relevance (best match first; stable for ties). */
export function searchTracks(
  tracks: Track[],
  query: string,
  memoryNotesByTrackId?: ReadonlyMap<string, readonly string[]>,
): Track[] {
  if (!query.trim()) return tracks;
  return tracks
    .map((track, index) => ({
      track,
      index,
      score: trackSearchScore(track, query, memoryNotesByTrackId?.get(track.id) ?? []),
    }))
    .filter((entry) => entry.score < NO_MATCH_SCORE)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.track);
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

/** Every scope token matches `name` (via the transliteration variant sets). */
function entityMatches(name: string, tokens: readonly string[]): boolean {
  const fieldVariants = searchVariants(name);
  return tokens.every(
    (token) => scoreVariants(searchVariants(token), fieldVariants) < NO_MATCH_SCORE,
  );
}

/**
 * Match derived artist/album entities for the faceted search surface. An artist
 * matches when every artist-relevant token (free + `artist:`) matches its
 * display name; an album matches when every album-relevant token (free +
 * `album:`) matches "album · artist". A facet stays empty when no relevant token
 * is present (so e.g. `album:foo` surfaces only albums). Pseudo buckets never
 * appear as search hits. Matching is transliteration-aware (pinyin/romaji).
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
      : artists.filter((entry) => !entry.bucket && entityMatches(entry.name, artistTokens));
  const matchedAlbums =
    albumTokens.length === 0
      ? []
      : albums.filter(
          (entry) =>
            !entry.bucket && entityMatches(`${entry.name} ${entry.artistName ?? ""}`, albumTokens),
        );
  return { artists: matchedArtists, albums: matchedAlbums };
}

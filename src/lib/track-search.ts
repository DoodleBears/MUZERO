import type { Track, TrackLyrics } from "@/db/types";
import type { AlbumEntry, ArtistEntry } from "@/lib/library-index";
import {
  type IndexableRow,
  parseSearchTokens,
  type SearchTokens,
  scoreRow,
} from "@/lib/search-core";
import { NO_MATCH_SCORE, scoreVariants, searchVariants } from "@/lib/search-transliterate";
import { parseLyrics } from "@/lyrics/parse";

export type { SearchTokens } from "@/lib/search-core";
// Re-export the source-agnostic token helpers so existing importers (e.g.
// r2-search-catalog) keep their import path.
export { isEmptyTokens, parseSearchTokens } from "@/lib/search-core";

/**
 * Track search over annotations + metadata. "Music carries memories", so the
 * track's memories and tags are first-class search surfaces alongside
 * title/caption. All query tokens must match (AND).
 *
 * This module is the Track-specific adapter over the source-agnostic matcher in
 * [`search-core`]: it maps a `Track` to an `IndexableRow` and delegates scoring,
 * so local and remote (catalog) rows share one matcher. Matching is
 * transliteration-aware — CJK fields are reachable by Chinese pinyin (full +
 * 首字母 initials) and Japanese kana↔romaji — and results rank by a tiered score
 * (exact < prefix < substring < subsequence). It degrades to substring matching
 * until the dictionaries load, so behavior never regresses.
 *
 * Tokens are field-scoped, extending the original `#tag` convention:
 *   - `#tag`     → matches tags only
 *   - `artist:x` → matches the artist / album-artist fields only
 *   - `album:x`  → matches the album field only
 *   - bare       → matched against any field
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

function pushText(fields: string[], value: string | undefined): void {
  const text = value?.trim();
  if (text) fields.push(text);
}

/**
 * Searchable lyric text for a track. Stored lyrics live in their own table, so
 * callers join the optional row in only on surfaces that need lyrics search.
 * Parsed line text is included in addition to raw LRC/yrc/qrc/TTML so timestamp
 * and word-timing syntax never gets in the way of matching actual words.
 */
export function lyricsSearchFields(
  track: Track,
  lyrics: Pick<
    TrackLyrics,
    "status" | "instrumental" | "synced" | "plain" | "translation" | "romanization" | "format"
  > | null = null,
): string[] {
  const fields: string[] = [];
  if (lyrics && (lyrics.instrumental || lyrics.status === "instrumental")) return fields;

  if (lyrics) {
    pushText(fields, lyrics.plain);
    pushText(fields, lyrics.synced);
    pushText(fields, lyrics.translation);
    pushText(fields, lyrics.romanization);
    if (lyrics.synced?.trim()) {
      try {
        for (const line of parseLyrics(lyrics.synced, lyrics.format)) {
          pushText(fields, line.text);
          pushText(fields, line.translation);
          pushText(fields, line.roman);
          const words = line.words?.map((word) => word.text).join("");
          pushText(fields, words);
        }
      } catch {
        // Keep raw lyric text searchable even if a future/invalid format fails to parse.
      }
    }
  }

  pushText(fields, track.brief?.lyrics);
  return fields;
}

export interface LyricSearchMatch {
  text: string;
  timeSec?: number;
}

function lyricCandidateMatches(query: string, text: string): boolean {
  if (!query.trim()) return true;
  return (
    scoreRow({ id: "", free: [text], artist: [], album: [], tags: [] }, parseSearchTokens(query)) <
    NO_MATCH_SCORE
  );
}

function pushLyricCandidate(
  candidates: LyricSearchMatch[],
  text: string | undefined,
  timeSec?: number,
): void {
  const trimmed = text?.trim();
  if (trimmed) candidates.push({ text: trimmed, timeSec });
}

export function findLyricSearchMatch(
  track: Track,
  lyrics: Pick<
    TrackLyrics,
    "status" | "instrumental" | "synced" | "plain" | "translation" | "romanization" | "format"
  > | null = null,
  query = "",
): LyricSearchMatch | null {
  if (lyrics && (lyrics.instrumental || lyrics.status === "instrumental")) return null;

  const candidates: LyricSearchMatch[] = [];
  if (lyrics?.synced?.trim()) {
    try {
      for (const line of parseLyrics(lyrics.synced, lyrics.format)) {
        const timeSec = line.timeMs / 1000;
        pushLyricCandidate(candidates, line.text, timeSec);
        pushLyricCandidate(candidates, line.translation, timeSec);
        pushLyricCandidate(candidates, line.roman, timeSec);
        pushLyricCandidate(candidates, line.words?.map((word) => word.text).join(""), timeSec);
      }
    } catch {
      // Raw text remains searchable/displayable below.
    }
  }
  if (lyrics?.plain) {
    for (const line of lyrics.plain.split(/\r?\n/)) pushLyricCandidate(candidates, line);
  }
  if (lyrics?.translation) {
    for (const line of lyrics.translation.split(/\r?\n/)) pushLyricCandidate(candidates, line);
  }
  if (lyrics?.romanization) {
    for (const line of lyrics.romanization.split(/\r?\n/)) pushLyricCandidate(candidates, line);
  }
  if (lyrics?.synced && candidates.length === 0) {
    for (const line of lyrics.synced.split(/\r?\n/)) pushLyricCandidate(candidates, line);
  }
  if (track.brief?.lyrics) {
    for (const line of track.brief.lyrics.split(/\r?\n/)) pushLyricCandidate(candidates, line);
  }

  return candidates.find((candidate) => lyricCandidateMatches(query, candidate.text)) ?? null;
}

function trackArtistText(track: Track): string {
  const m = track.mediaMetadata;
  return [...(m?.artists ?? []), ...(m?.albumArtists ?? [])].join(" ");
}

/** Reduce a track (+ its memory notes) to the source-agnostic searchable row. */
export function trackToRow(
  track: Track,
  memoryNotes: readonly string[] = [],
  extraFreeFields: readonly string[] = [],
): IndexableRow {
  return {
    id: track.id,
    free: [...trackSearchFields(track, memoryNotes), ...extraFreeFields],
    artist: [trackArtistText(track)].filter((s) => s.length > 0),
    album: [track.mediaMetadata?.album ?? ""].filter((s) => s.length > 0),
    tags: track.tags,
  };
}

/** Relevance score for a track against a query (lower = better; see `scoreRow`). */
export function trackSearchScore(
  track: Track,
  query: string,
  memoryNotes: readonly string[] = [],
): number {
  return scoreRow(trackToRow(track, memoryNotes), parseSearchTokens(query));
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
  const { free, artist, album }: SearchTokens = parseSearchTokens(query);
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

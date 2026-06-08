import type { Track } from "@/db/types";

/**
 * Pure track search over annotations + metadata. "Music carries memories", so
 * the track's memories and tags are first-class search surfaces alongside
 * title/caption. All query tokens must match somewhere (AND); each token is a
 * case-insensitive substring match against any field. A `#tag` token matches
 * tags only.
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

export function matchesQuery(
  track: Track,
  query: string,
  memoryNotes: readonly string[] = [],
): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = trackSearchText(track, memoryNotes);
  return tokens.every((token) => {
    if (token.startsWith("#") && token.length > 1) {
      const tag = token.slice(1);
      return track.tags.some((t) => t.includes(tag));
    }
    return haystack.includes(token);
  });
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

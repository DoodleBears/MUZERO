import type { Track } from "@/db/types";

/**
 * Pure track search over annotations + metadata. "Music carries memories", so
 * the note and tags are first-class search surfaces alongside title/caption.
 * All query tokens must match somewhere (AND); each token is a case-insensitive
 * substring match against any field. A `#tag` token matches tags only.
 */
export function trackSearchText(track: Track): string {
  return [
    track.title,
    track.brief?.caption ?? "",
    track.note ?? "",
    track.tags.join(" "),
    track.provider,
  ]
    .join(" ")
    .toLowerCase();
}

export function matchesQuery(track: Track, query: string): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = trackSearchText(track);
  return tokens.every((token) => {
    if (token.startsWith("#") && token.length > 1) {
      const tag = token.slice(1);
      return track.tags.some((t) => t.includes(tag));
    }
    return haystack.includes(token);
  });
}

export function searchTracks(tracks: Track[], query: string): Track[] {
  if (!query.trim()) return tracks;
  return tracks.filter((t) => matchesQuery(t, query));
}

/** Tracks carrying a given tag (exact, case-insensitive). */
export function tracksWithTag(tracks: Track[], tag: string): Track[] {
  const needle = tag.trim().toLowerCase();
  return tracks.filter((t) => t.tags.includes(needle));
}

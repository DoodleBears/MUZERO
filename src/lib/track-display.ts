import type { SetDisplayMode, Track } from "@/db/types";

/** What the "stage" should render for the current track. */
export type StageContent = "video" | "cover" | "title";

/**
 * Whether a track can play its own moving video right now — the single predicate
 * both the foreground stage and the ambient Pixi background key on so they never
 * disagree about "is this a video". A track is a playable video iff it's a
 * `video` kind that has finished landing (`status === "ready"`); a generating /
 * pending / failed video has no playable bytes yet, so the stage falls back to
 * cover/title and the background stays on the image path. Undefined → false.
 */
export function trackIsPlayableVideo(track: Pick<Track, "kind" | "status"> | undefined): boolean {
  return track?.kind === "video" && track.status === "ready";
}

/**
 * Resolve what to show on the now-playing stage, honoring the set's display mode
 * with the fallback the product wants: video-first → cover → title.
 *  - "video" mode: play the video when available, else a cover image if present,
 *    else the title card.
 *  - "cover" mode: cover image if present, else title.
 */
export function resolveStageContent(opts: {
  track?: Track;
  displayMode: SetDisplayMode;
  hasCover: boolean;
}): StageContent {
  const { track, displayMode, hasCover } = opts;
  if (!track) return "title";
  if (displayMode === "cover") return hasCover ? "cover" : "title";
  // displayMode === "video"
  if (trackIsPlayableVideo(track)) return "video";
  if (hasCover) return "cover";
  return "title";
}

/**
 * Whether a track has any cover to render — a local cover blob OR a remote cover
 * URL. Streamed tracks (NetEase / Bilibili / …) keep their art as `remoteCoverUrl`
 * with no local blob, so a `coverBlobId`-only check wrongly reports "no cover" and
 * the cover stage / ambient background fall through to title. Single read authority
 * so every cover surface agrees.
 */
export function trackHasCover(
  track: Pick<Track, "coverBlobId" | "remoteCoverUrl"> | undefined,
): boolean {
  return !!track?.coverBlobId || !!track?.remoteCoverUrl;
}

/**
 * The single normalization used as the artist/album join key: trim, lowercase,
 * collapse internal whitespace. Unicode/CJK-safe (does not strip non-ASCII).
 * Mirrors the tag-normalization discipline so every surface keys identically.
 */
export function normalizeArtistName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * A track's display artists — the single read authority for "who made this".
 * Uses embedded `artists[]`, falling back to `albumArtists[]`; empty for
 * brief-only generated tracks (no embedded metadata). De-dupes by normalized
 * name, preserving the first original spelling.
 */
export function trackArtists(track: Track): string[] {
  const metadata = track.mediaMetadata;
  let raw = (metadata?.artists?.length ? metadata.artists : metadata?.albumArtists) ?? [];
  // Streamed tracks keep their artist in streamMeta — fall back to it (covers rows
  // created before streamMeta was mirrored into mediaMetadata).
  if (raw.length === 0 && track.streamMeta?.artist) raw = [track.streamMeta.artist];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of raw) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const key = normalizeArtistName(trimmed);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** A track's display album title, or undefined when absent. */
export function trackAlbum(track: Track): string | undefined {
  return track.mediaMetadata?.album?.trim() || track.streamMeta?.album?.trim() || undefined;
}

/**
 * A short subtitle line for a track. Returns data only (caption → note → title);
 * the empty-track fallback copy is localized at the call site.
 */
export function trackSubtitle(track: Track | undefined): string {
  if (!track) return "";
  if (track.brief?.caption) return track.brief.caption;
  const metadata = track.mediaMetadata;
  const artist = metadata?.artists?.join(", ") || track.streamMeta?.artist;
  const album = metadata?.album || track.streamMeta?.album;
  if (artist && album) return `${artist} - ${album}`;
  if (artist) return artist;
  if (album) return album;
  return track.note ?? track.title;
}

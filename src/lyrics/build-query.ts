/**
 * Build a LyricsQuery from a track's display metadata. Returns null when there
 * isn't enough to look up meaningfully (no title or no artist) — the caller then
 * skips auto-fetch (low hit rate + needless privacy egress) and leaves it to the
 * manual flow. Pure — reuses the single artist/album read authorities.
 */

import type { Track } from "@/db/types";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import type { LyricsQuery } from "./provider";

export function buildLyricsQuery(track: Track): LyricsQuery | null {
  const trackName = track.title?.trim() ?? "";
  const artistName = trackArtists(track).join(", ").trim();
  // A streamed NetEase track carries the exact songId — enough to fetch official
  // lyrics with no title/artist. Other tracks still need both for a meaningful lookup.
  const neteaseSongId = track.streamSourceId === "netease" ? track.streamExternalId : undefined;
  if (!neteaseSongId && (!trackName || !artistName)) return null;
  const durationSec =
    Number.isFinite(track.durationSec) && track.durationSec > 0 ? track.durationSec : undefined;
  return { trackName, artistName, albumName: trackAlbum(track), durationSec, neteaseSongId };
}

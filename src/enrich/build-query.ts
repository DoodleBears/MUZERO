/**
 * Build an EnrichmentQuery from a track's display metadata. Returns null when there
 * isn't enough to look up meaningfully (no title or no artist) — the caller then skips
 * auto-enrich (low hit rate + needless egress). Pure — reuses the single artist/album
 * read authorities and never romanizes (E2E: native CJK names match MusicBrainz better
 * than romanized ones — see the enrichment PRD).
 */

import type { Track } from "@/db/types";
import { trackAlbum, trackArtists } from "@/lib/track-display";
import type { EnrichmentQuery } from "./provider";

export function buildEnrichmentQuery(track: Track): EnrichmentQuery | null {
  const trackName = track.title?.trim() ?? "";
  const artistName = trackArtists(track).join(", ").trim();
  if (!trackName || !artistName) return null;
  return {
    trackName,
    artistName,
    albumName: trackAlbum(track),
    // Native-detail path (Phase 4): a streamed track carries the source's own id + source.
    externalId: track.streamExternalId,
    streamSourceId: track.streamSourceId,
    // Exact MB lookup when a file's ID3 already carried an MBID.
    musicBrainzRecordingId: track.mediaMetadata?.musicBrainzRecordingId,
  };
}

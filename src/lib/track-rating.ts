import type { Track } from "@/db/types";

/**
 * Derive the persistent rating chip's value from a track's per-rater votes
 * (`Track.ratingsByRater`). Crowd average with per-rater dedup: each rater (host
 * `self` + each audience key) counts once, so the average + count reflect distinct
 * voters. Returns null when there are no votes (chip shows the empty state).
 */
export function resolveTrackRating(
  track: Pick<Track, "ratingsByRater">,
): { average: number; count: number } | null {
  const votes = track.ratingsByRater;
  if (!votes) return null;
  const values = Object.values(votes).filter((value) => Number.isFinite(value));
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  const average = Math.round((sum / values.length) * 10) / 10;
  return { average, count: values.length };
}

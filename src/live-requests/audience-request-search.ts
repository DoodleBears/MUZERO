import type { Track, TrackLyrics } from "@/db/types";
import { NO_MATCH_SCORE } from "@/lib/search-transliterate";
import { lyricsSearchFields, trackSearchScore } from "@/lib/track-search";

export interface AudienceRequestSearchHit {
  track: Track;
  score: number;
}

export type AudienceRequestSearchResult =
  | {
      kind: "match";
      best: AudienceRequestSearchHit;
      candidates: AudienceRequestSearchHit[];
      onlineFallbackRecommended: false;
    }
  | {
      kind: "low-confidence";
      best?: AudienceRequestSearchHit;
      candidates: AudienceRequestSearchHit[];
      onlineFallbackRecommended: boolean;
    }
  | {
      kind: "no-match";
      candidates: [];
      onlineFallbackRecommended: boolean;
    };

export interface PickAudienceRequestMatchInput {
  tracks: readonly Track[];
  query: string;
  memoryNotesByTrackId?: ReadonlyMap<string, readonly string[]>;
  lyricsByTrackId?: ReadonlyMap<
    string,
    Pick<
      TrackLyrics,
      "status" | "instrumental" | "synced" | "plain" | "translation" | "romanization" | "format"
    >
  >;
  threshold: number;
  margin: number;
  avoidCurrentTrackId?: string;
  onlineFallbackOnLowConfidence?: boolean;
  hasConfiguredOnlineSources?: boolean;
}

function shouldTryOnlineFallback(input: PickAudienceRequestMatchInput): boolean {
  return Boolean(input.onlineFallbackOnLowConfidence && input.hasConfiguredOnlineSources);
}

function scoreTrack(input: PickAudienceRequestMatchInput, track: Track): number {
  const memoryNotes = input.memoryNotesByTrackId?.get(track.id) ?? [];
  const lyrics = input.lyricsByTrackId?.get(track.id) ?? null;
  const lyricFields = lyrics ? lyricsSearchFields(track, lyrics) : [];
  if (lyricFields.length === 0) return trackSearchScore(track, input.query, memoryNotes);
  return Math.min(
    trackSearchScore(track, input.query, memoryNotes),
    trackSearchScore(
      { ...track, note: [track.note, ...lyricFields].filter(Boolean).join(" ") },
      input.query,
      memoryNotes,
    ),
  );
}

export function pickAudienceRequestMatch(
  input: PickAudienceRequestMatchInput,
): AudienceRequestSearchResult {
  const query = input.query.trim();
  if (!query) {
    return {
      kind: "no-match",
      candidates: [],
      onlineFallbackRecommended: shouldTryOnlineFallback(input),
    };
  }

  const candidates = input.tracks
    .filter((track) => track.id !== input.avoidCurrentTrackId)
    .map((track, index) => ({ track, index, score: scoreTrack(input, track) }))
    .filter((hit) => hit.score < NO_MATCH_SCORE)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ track, score }) => ({ track, score }));

  const best = candidates[0];
  if (!best) {
    return {
      kind: "no-match",
      candidates: [],
      onlineFallbackRecommended: shouldTryOnlineFallback(input),
    };
  }

  const second = candidates[1];
  const clearWinner = !second || second.score - best.score >= input.margin;
  const confident = best.score <= input.threshold && clearWinner;

  if (!confident) {
    return {
      kind: "low-confidence",
      best,
      candidates,
      onlineFallbackRecommended: shouldTryOnlineFallback(input),
    };
  }

  return { kind: "match", best, candidates, onlineFallbackRecommended: false };
}

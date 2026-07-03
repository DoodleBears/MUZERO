/**
 * QQ Music enrichment provider — QQ's song detail carries an authoritative human-readable
 * genre for CJK tracks (which MusicBrainz/Last.fm cover poorly), so it sits FIRST in the auto
 * order. It self-skips any non-QQ track (returns null before any network call) so a NetEase /
 * Bilibili externalId is never mis-resolved as a QQ mid. The actual detail fetch is injected
 * (`fetchNativeGenre`, from `streamsrc/qq/qq-genre`) — pure + unit-testable, no QQ signing here.
 */

import type { QqNativeGenre } from "@/streamsrc/qq/qq-genre";
import { normalizeGenres } from "./normalize";
import type { EnrichmentHit, EnrichmentQuery, MetadataEnrichmentProvider } from "./provider";

/** QQ native per-track genre is authoritative for CJK → high confidence. */
export const QQ_NATIVE_CONFIDENCE = 0.85;

export interface QqEnrichmentConfig {
  fetchNativeGenre: (mid: string, signal?: AbortSignal) => Promise<QqNativeGenre | null>;
}

export function createQqEnrichmentProvider(cfg: QqEnrichmentConfig): MetadataEnrichmentProvider {
  return {
    id: "qq",
    label: "QQ 音乐",
    async fetch(q: EnrichmentQuery, signal?: AbortSignal): Promise<EnrichmentHit | null> {
      if (q.streamSourceId !== "qq" || !q.externalId) return null; // QQ tracks only
      const native = await cfg.fetchNativeGenre(q.externalId, signal);
      const genres = normalizeGenres(native?.genres ?? []);
      if (genres.length === 0) return null;
      return {
        source: "qq",
        genres,
        rawTags: native?.genres,
        match: { confidence: QQ_NATIVE_CONFIDENCE, via: "native" },
      };
    },
  };
}

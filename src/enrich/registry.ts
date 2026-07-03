/**
 * Resolve the active enrichment provider from settings. Pluggable boundary (mirrors
 * `lyrics/registry.ts` / `musicgen/registry.ts`): to add a source, extend
 * `EnrichmentSource`, implement `MetadataEnrichmentProvider`, and branch here — never
 * scatter `if (source === …)` across DJ / store / UI (rule 5).
 *
 * v1 ships MusicBrainz only (keyless baseline). Phase 3 adds Last.fm / Discogs (BYOK) and
 * an ordered/auto strategy; Phase 4 folds in QQ's native detail genre.
 */

import type { AppSettings } from "@/db/types";
import { createMusicbrainzProvider } from "./musicbrainz-provider";
import type { MetadataEnrichmentProvider } from "./provider";

export function resolveEnrichmentProvider(_settings: AppSettings): MetadataEnrichmentProvider {
  return createMusicbrainzProvider();
}

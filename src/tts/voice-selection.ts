/**
 * Selecting a Fish voice should REMEMBER it (voice-DJ PRD §12 Fix B): persist the
 * selection AND cache the voice's metadata into the used-voices list, so next
 * launch it renders + stays selected without re-fetching / re-searching.
 */

import type { AppSettings, CachedVoiceModel } from "@/db/types";
import type { VoiceModel } from "./provider";

function cacheEntry(voice: VoiceModel): CachedVoiceModel {
  return {
    id: voice.id,
    title: voice.title,
    coverImage: voice.coverImage,
    samples: voice.samples,
  };
}

/**
 * Settings patch to select `voice`: sets `ttsVoiceId`, adds it to the persistent
 * used-voices id list (`ttsAddedVoiceIds`, deduped), and caches/refreshes its
 * metadata (`ttsAddedVoiceCache`). Idempotent — re-selecting the same voice
 * refreshes its cached metadata without growing the lists.
 */
export function selectVoicePatch(settings: AppSettings, voice: VoiceModel): Partial<AppSettings> {
  const ids = settings.ttsAddedVoiceIds ?? [];
  const cache = settings.ttsAddedVoiceCache ?? [];
  const entry = cacheEntry(voice);
  return {
    ttsVoiceId: voice.id,
    ttsAddedVoiceIds: ids.includes(voice.id) ? ids : [...ids, voice.id],
    ttsAddedVoiceCache: cache.some((m) => m.id === voice.id)
      ? cache.map((m) => (m.id === voice.id ? entry : m))
      : [...cache, entry],
  };
}

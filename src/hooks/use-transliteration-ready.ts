import { useEffect, useState } from "react";
import { log } from "@/lib/logger";
import {
  ensureTransliterationLoaded,
  getTransliterationLoadError,
  isTransliterationReady,
} from "@/lib/search-transliterate";

/**
 * Lazily load the transliteration dictionaries on the main thread and report
 * when they're ready. Use the returned flag as a render/memo dependency so a
 * synchronous matcher (e.g. `searchEntityFacets`, the inline track filter)
 * re-runs once pinyin/kana/romaji become available — search "snaps in" without
 * the user retyping. The import is dynamic + async, so it never blocks paint.
 */
export function useTransliterationReady(): boolean {
  const [ready, setReady] = useState(isTransliterationReady);
  useEffect(() => {
    if (ready) return;
    let active = true;
    void ensureTransliterationLoaded().then(() => {
      if (!active) return;
      if (isTransliterationReady()) {
        setReady(true);
      } else {
        // Dictionaries failed to load → pinyin/kana/romaji matching is unavailable and
        // search silently degraded to substring. Surface WHY (the usual cause is the
        // dynamic-import chunk not resolving in a packaged build).
        log.warn(
          "search",
          "transliteration dictionaries failed to load; pinyin/romaji search disabled",
          {
            error: getTransliterationLoadError(),
          },
        );
      }
    });
    return () => {
      active = false;
    };
  }, [ready]);
  return ready;
}

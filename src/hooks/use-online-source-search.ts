/**
 * Debounced search across the user's *enabled* external sources, for the global
 * (⌘/Ctrl+F) search overlay. Off by default — returns nothing until the user
 * enables a source. Each source is queried concurrently; failures degrade to no
 * results for that source rather than failing the whole search.
 */

import { useEffect, useState } from "react";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource, STREAM_SOURCE_IDS } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";

const DEBOUNCE_MS = 350;
const PER_SOURCE_LIMIT = 6;

export interface OnlineSearchState {
  hits: StreamSearchHit[];
  searching: boolean;
  /** The sources currently enabled (so the UI can show "enable a source" hints). */
  enabledSources: StreamSourceId[];
}

export function useOnlineSourceSearch(query: string): OnlineSearchState {
  const settings = useSettings();
  const streamSources = settings.streamSources;
  const enabledSources = STREAM_SOURCE_IDS.filter((id) => streamSources?.[id]?.enabled);
  // Stable dependency key so the effect doesn't re-run on unrelated settings churn.
  const enabledKey = JSON.stringify(
    enabledSources.map((id) => [
      id,
      streamSources?.[id]?.cookie ?? "",
      streamSources?.[id]?.quality ?? "",
    ]),
  );

  const [hits, setHits] = useState<StreamSearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: enabledKey encodes the relevant settings slice
  useEffect(() => {
    const q = query.trim();
    if (!q || enabledSources.length === 0) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const http = createStreamHttp();
      const perSource = await Promise.all(
        enabledSources.map(async (id) => {
          const source = createStreamSource(id, {
            http,
            now: () => Date.now(),
            getCookie: (sid) => streamSources?.[sid]?.cookie,
          });
          if (!source) return [];
          try {
            return await source.search(q, { limit: PER_SOURCE_LIMIT, signal: controller.signal });
          } catch {
            return [];
          }
        }),
      );
      if (cancelled) return;
      setHits(perSource.flat());
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [query, enabledKey]);

  return { hits, searching, enabledSources };
}

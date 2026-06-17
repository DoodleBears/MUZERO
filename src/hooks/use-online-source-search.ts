/**
 * Debounced search across the user's *enabled* external sources, for the global
 * (⌘/Ctrl+F) search overlay. Off by default — returns nothing until the user
 * enables a source. Each source is queried concurrently; failures degrade to no
 * results for that source rather than failing the whole search.
 */

import { useEffect, useState } from "react";
import type { StreamSourceId } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource, STREAM_SOURCE_IDS } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import {
  expandStreamLink,
  parseStreamLink,
  qqShortLinkUrl,
  type StreamLinkRef,
} from "@/streamsrc/stream-link";

const DEBOUNCE_MS = 350;
const PER_SOURCE_LIMIT = 6;

export interface OnlineSearchState {
  hits: StreamSearchHit[];
  searching: boolean;
  /** The sources currently enabled (so the UI can show "enable a source" hints). */
  enabledSources: StreamSourceId[];
  /** When the query is a recognized share link, the resolved ref (else null). */
  link: StreamLinkRef | null;
  /** When the link is a playlist, its meta to offer for import (else null). */
  playlistLink: StreamPlaylist | null;
}

export function useOnlineSourceSearch(
  query: string,
  forcedSource?: StreamSourceId,
): OnlineSearchState {
  const settings = useSettings();
  const streamSources = settings.streamSources;
  // A forced source (the ⌘F `@bili` / `@网易云` filter) searches that one source
  // ad-hoc, regardless of the persisted enable chips; otherwise honor them.
  const enabledSources = forcedSource
    ? [forcedSource]
    : STREAM_SOURCE_IDS.filter((id) => streamSources?.[id]?.enabled);
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
  const [playlistLink, setPlaylistLink] = useState<StreamPlaylist | null>(null);
  // The resolved ref — set synchronously for a full link, or after one redirect hop
  // for a short link (qqShortLinkUrl). State (not derived) so short links populate it.
  const [link, setLink] = useState<StreamLinkRef | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: enabledKey encodes the relevant settings slice
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      setPlaylistLink(null);
      setLink(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const makeSource = (id: StreamSourceId) =>
      createStreamSource(id, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (sid) => streamSources?.[sid]?.cookie,
      });

    // A pasted share link resolves immediately (no debounce) and works even if the
    // source's search chip is off — the intent is explicit. A short link (no id in the
    // URL) takes one redirect hop to expand before it parses.
    const directRef = parseStreamLink(q);
    const shortUrl = directRef ? null : qqShortLinkUrl(q);
    if (directRef || shortUrl) {
      setSearching(true);
      setPlaylistLink(null);
      setLink(directRef);
      void (async () => {
        let ref = directRef;
        if (!ref && shortUrl) {
          try {
            ref = await expandStreamLink(q, createStreamHttp(), { signal: controller.signal });
          } catch {
            ref = null;
          }
          if (!cancelled) setLink(ref);
        }
        if (!ref) {
          if (!cancelled) {
            setHits([]);
            setPlaylistLink(null);
            setSearching(false);
          }
          return;
        }
        const source = makeSource(ref.source);
        try {
          if (ref.kind === "playlist") {
            const meta =
              (await source?.getPlaylistMeta?.(ref.id, { signal: controller.signal })) ?? null;
            if (!cancelled) {
              setHits([]);
              setPlaylistLink(meta);
            }
          } else {
            const found =
              (await source?.getTracksByIds?.([ref.id], { signal: controller.signal })) ?? [];
            if (!cancelled) {
              setHits(found);
              setPlaylistLink(null);
            }
          }
        } catch {
          if (!cancelled) {
            setHits([]);
            setPlaylistLink(null);
          }
        } finally {
          if (!cancelled) setSearching(false);
        }
      })();
      return () => {
        cancelled = true;
        controller.abort();
      };
    }
    setLink(null);

    if (enabledSources.length === 0) {
      setHits([]);
      setPlaylistLink(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setPlaylistLink(null);
    const timer = window.setTimeout(async () => {
      const perSource = await Promise.all(
        enabledSources.map(async (id) => {
          const source = makeSource(id);
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

  return { hits, searching, enabledSources, link, playlistLink };
}

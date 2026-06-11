import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Track } from "@/db/types";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import { trackToRow } from "@/lib/track-search";
import { searchRows, setSearchRows } from "@/workers/search-client";

/**
 * Worker-backed track search. Pushes the searchable row snapshot to the search
 * Worker whenever the library changes (cheap strings, infrequent) and runs each
 * query off the main thread, so phonetic (pinyin / kana / romaji) scanning of a
 * large library never janks the UI. `useDeferredValue` keeps the input crisp;
 * the Worker's inline fallback (no Worker / tests) keeps results correct.
 *
 * Returns the ranked tracks for the current query, best match first. An empty
 * query returns the input list unchanged (input order preserved).
 */
export function useWorkerTrackSearch(
  tracks: Track[],
  query: string,
  memoryNotesByTrackId?: ReadonlyMap<string, readonly string[]>,
): Track[] {
  const deferredQuery = useDeferredValue(query);
  const [result, setResult] = useState<Track[]>(tracks);

  // Push the row snapshot whenever the library (or its memories) changes —
  // coalesced: serializing + structured-cloning the whole library per write
  // turns an import burst into O(N×writes) (PRD F-3). Queries below still rank
  // against the live `tracks`, so results never lag behind the visible list.
  const snapshotTracks = useThrottledValue(tracks, LIBRARY_QUERY_COALESCE_MS);
  const snapshotNotes = useThrottledValue(memoryNotesByTrackId, LIBRARY_QUERY_COALESCE_MS);
  useEffect(() => {
    setSearchRows(
      snapshotTracks.map((track) => trackToRow(track, snapshotNotes?.get(track.id) ?? [])),
    );
  }, [snapshotTracks, snapshotNotes]);

  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);

  useEffect(() => {
    if (!deferredQuery.trim()) {
      setResult(tracks);
      return;
    }
    let cancelled = false;
    void searchRows(deferredQuery).then((hits) => {
      if (cancelled) return;
      setResult(hits.map((hit) => byId.get(hit.id)).filter((t): t is Track => t !== undefined));
    });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery, tracks, byId]);

  return result;
}

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Track } from "@/db/types";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import type { IndexableRow, QueryHit } from "@/lib/search-core";
import { trackToRow } from "@/lib/track-search";
import { searchRows, setSearchRows } from "@/workers/search-client";

export interface WorkerTrackSearchOptions {
  /** Additional free-scope strings to index per track (e.g. joined lyrics rows). */
  extraFreeFieldsByTrackId?: ReadonlyMap<string, readonly string[]>;
  /** `lyrics` indexes only `extraFreeFieldsByTrackId`, used by the @lyrics scope. */
  rowKind?: "track" | "lyrics";
}

export function useWorkerRowSearch(rows: readonly IndexableRow[], query: string): QueryHit[] {
  const deferredQuery = useDeferredValue(query);
  const [result, setResult] = useState<QueryHit[]>([]);
  const [searchIndexRevision, setSearchIndexRevision] = useState(0);
  const snapshotRows = useThrottledValue(rows, LIBRARY_QUERY_COALESCE_MS);

  useEffect(() => {
    setSearchRows(snapshotRows);
    setSearchIndexRevision((revision) => revision + 1);
  }, [snapshotRows]);

  useEffect(() => {
    // Re-run when the Worker index changes even if the typed query is unchanged.
    void searchIndexRevision;
    if (!deferredQuery.trim()) {
      setResult(rows.map((row) => ({ id: row.id, score: 0 })));
      return;
    }
    let cancelled = false;
    void searchRows(deferredQuery).then((hits) => {
      if (!cancelled) setResult(hits);
    });
    return () => {
      cancelled = true;
    };
  }, [deferredQuery, rows, searchIndexRevision]);

  return result;
}

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
  options: WorkerTrackSearchOptions = {},
): Track[] {
  // Push the row snapshot whenever the library (or its memories) changes —
  // coalesced: serializing + structured-cloning the whole library per write
  // turns an import burst into O(N×writes) (PRD F-3). Queries below still rank
  // against the live `tracks`, so results never lag behind the visible list.
  const snapshotTracks = useThrottledValue(tracks, LIBRARY_QUERY_COALESCE_MS);
  const snapshotNotes = useThrottledValue(memoryNotesByTrackId, LIBRARY_QUERY_COALESCE_MS);
  const snapshotExtra = useThrottledValue(
    options.extraFreeFieldsByTrackId,
    LIBRARY_QUERY_COALESCE_MS,
  );
  const rows = useMemo(
    () =>
      snapshotTracks.map((track) => {
        const extra = snapshotExtra?.get(track.id) ?? [];
        if (options.rowKind === "lyrics") {
          return { id: track.id, free: [...extra], artist: [], album: [], tags: [] };
        }
        return trackToRow(track, snapshotNotes?.get(track.id) ?? [], extra);
      }),
    [snapshotTracks, snapshotNotes, snapshotExtra, options.rowKind],
  );
  const hits = useWorkerRowSearch(rows, query);

  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  return useMemo(
    () =>
      hits.map((hit) => byId.get(hit.id)).filter((track): track is Track => track !== undefined),
    [hits, byId],
  );
}

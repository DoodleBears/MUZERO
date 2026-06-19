import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Track } from "@/db/types";
import { LIBRARY_QUERY_COALESCE_MS, useThrottledValue } from "@/hooks/use-throttled-value";
import { notePerfWork } from "@/lib/perf-counters";
import type { IndexableRow, QueryHit } from "@/lib/search-core";
import { trackToRow } from "@/lib/track-search";
import { searchRows, setSearchRows } from "@/workers/search-client";

export interface WorkerTrackSearchOptions {
  /** Additional free-scope strings to index per track (e.g. joined lyrics rows). */
  extraFreeFieldsByTrackId?: ReadonlyMap<string, readonly string[]>;
  /** `lyrics` indexes only `extraFreeFieldsByTrackId`, used by the @lyrics scope. */
  rowKind?: "track" | "lyrics";
}

const SEARCH_ROW_CACHE_LIMIT = 50_000;
const searchRowCache = new Map<string, { row: IndexableRow; sig: string }>();

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
  const rowKind = options.rowKind;
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
  const rows = useMemo(() => {
    const startedAt = performance.now();
    const rows = snapshotTracks.map((track) => {
      const extra = snapshotExtra?.get(track.id) ?? [];
      const memoryNotes = snapshotNotes?.get(track.id) ?? [];
      const cacheKey = `${rowKind ?? "track"}:${track.id}`;
      const sig =
        rowKind === "lyrics"
          ? searchArraySignature(extra)
          : trackSearchRowSignature(track, memoryNotes, extra);
      const cached = searchRowCache.get(cacheKey);
      if (cached?.sig === sig) return cached.row;

      const row =
        rowKind === "lyrics"
          ? { id: track.id, free: [...extra], artist: [], album: [], tags: [] }
          : trackToRow(track, memoryNotes, extra);
      searchRowCache.set(cacheKey, { row, sig });
      if (searchRowCache.size > SEARCH_ROW_CACHE_LIMIT) {
        const oldestKey = searchRowCache.keys().next().value;
        if (oldestKey) searchRowCache.delete(oldestKey);
      }
      return row;
    });
    notePerfWork("search.rows.build", performance.now() - startedAt, {
      rowKind: rowKind ?? "track",
      rows: rows.length,
    });
    return rows;
  }, [snapshotTracks, snapshotNotes, snapshotExtra, rowKind]);
  const hits = useWorkerRowSearch(rows, query);

  const byId = useMemo(() => new Map(tracks.map((track) => [track.id, track])), [tracks]);
  return useMemo(
    () =>
      hits.map((hit) => byId.get(hit.id)).filter((track): track is Track => track !== undefined),
    [hits, byId],
  );
}

function searchArraySignature(values: readonly string[] | undefined): string {
  return (values ?? []).join("\u001f");
}

function trackSearchRowSignature(
  track: Track,
  memoryNotes: readonly string[],
  extraFreeFields: readonly string[],
): string {
  const m = track.mediaMetadata;
  return [
    track.title,
    m?.title,
    searchArraySignature(m?.artists),
    searchArraySignature(m?.albumArtists),
    m?.album,
    searchArraySignature(m?.genres),
    m?.year,
    m?.date,
    searchArraySignature(m?.composer),
    searchArraySignature(m?.isrc),
    m?.musicBrainzRecordingId,
    m?.musicBrainzTrackId,
    track.brief?.caption,
    track.note,
    searchArraySignature(track.tags),
    track.provider,
    searchArraySignature(memoryNotes),
    searchArraySignature(extraFreeFields),
  ]
    .map((value) => (value == null ? "" : String(value)))
    .join("\u001e");
}

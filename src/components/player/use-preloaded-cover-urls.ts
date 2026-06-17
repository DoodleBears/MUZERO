import { useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "@/hooks/use-app-data";
import { arePerfCountersEnabled, notePerfWork } from "@/lib/perf-counters";
import {
  buildCoverPreloadRequests,
  type CoverPreloadCandidate,
  filterCoverPreloadRequestsForBurst,
  type PreloadedCover,
  preloadCoverBatch,
  releasePreloadedCover,
} from "./cover-preload";

const COVER_PRELOAD_LOCAL_SETTLE_MS = 140;
const COVER_PRELOAD_NON_CURRENT_LOCAL_SETTLE_MS = 420;

/** Drop duplicate tracks (keep first role), so one track never preloads twice. */
export function compactPreloadCandidates(
  candidates: CoverPreloadCandidate[],
): CoverPreloadCandidate[] {
  const seen = new Set<string>();
  const out: CoverPreloadCandidate[] = [];
  for (const candidate of candidates) {
    const track = candidate.track;
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(candidate);
  }
  return out;
}

/**
 * Resolve preloaded (decoded, object-URL) covers for a set of candidate tracks,
 * returning a `trackId → url` map. Batches loads, releases superseded entries, and
 * defers non-current LOCAL covers by a short settle window so a rapid switch burst
 * doesn't flood the decode pipeline — `forceNonCurrentLocal` bypasses that defer
 * (a drag clearly wants the neighbour covers NOW). Extracted from the legacy
 * SwipeableMediaStage so the windowed cover pager can share it.
 */
export function usePreloadedCoverUrls(
  candidates: CoverPreloadCandidate[],
  forceNonCurrentLocal = false,
): Record<string, string> {
  const settings = useSettings();
  const coverCropped = settings.coverCropped ?? true;
  const entriesRef = useRef<Record<string, PreloadedCover>>({});
  const batchSeqRef = useRef(0);
  const [nonCurrentLocalReadyKey, setNonCurrentLocalReadyKey] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const requests = useMemo(
    () => buildCoverPreloadRequests(candidates, coverCropped),
    [candidates, coverCropped],
  );
  const requestsKey = useMemo(
    () => requests.map((request) => `${request.role}:${request.trackId}:${request.key}`).join("|"),
    [requests],
  );
  const includeNonCurrentLocal = forceNonCurrentLocal || nonCurrentLocalReadyKey === requestsKey;
  const activeRequestsRaw = useMemo(
    () => filterCoverPreloadRequestsForBurst(requests, includeNonCurrentLocal),
    [includeNonCurrentLocal, requests],
  );
  const activeRequestsKey = useMemo(
    () => activeRequestsRaw.map((r) => `${r.role}:${r.trackId}:${r.key}`).join("|"),
    [activeRequestsRaw],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: stabilize identity by content key
  const activeRequests = useMemo(() => activeRequestsRaw, [activeRequestsKey]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setNonCurrentLocalReadyKey(requestsKey),
      COVER_PRELOAD_NON_CURRENT_LOCAL_SETTLE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [requestsKey]);

  useEffect(() => {
    let alive = true;
    batchSeqRef.current += 1;
    const batchSeq = batchSeqRef.current;
    const isCurrent = () => alive && batchSeqRef.current === batchSeq;

    const load = async () => {
      const perfEnabled = arePerfCountersEnabled();
      const perfStartedAt = perfEnabled ? performance.now() : 0;
      const previous = entriesRef.current;

      const result = await preloadCoverBatch({
        isCurrent,
        localSettleMs: COVER_PRELOAD_LOCAL_SETTLE_MS,
        nonCurrentLocalSettleMs: 0,
        previous,
        requests: activeRequests,
      });
      if (!isCurrent() || result.canceled) {
        if (perfEnabled) {
          notePerfWork("cover.preload.batch", performance.now() - perfStartedAt, result.stats);
        }
        return;
      }

      const nextEntries = result.entries;
      entriesRef.current = nextEntries;
      setUrls(
        Object.fromEntries(
          Object.entries(nextEntries).map(([trackId, entry]) => [trackId, entry.url]),
        ),
      );

      for (const [trackId, entry] of Object.entries(previous)) {
        if (nextEntries[trackId]?.key !== entry.key) releasePreloadedCover(entry);
      }
      if (perfEnabled) {
        notePerfWork("cover.preload.batch", performance.now() - perfStartedAt, result.stats);
      }
    };

    void load();
    return () => {
      alive = false;
    };
  }, [activeRequests]);

  useEffect(() => {
    return () => {
      for (const entry of Object.values(entriesRef.current)) releasePreloadedCover(entry);
      entriesRef.current = {};
    };
  }, []);

  return urls;
}

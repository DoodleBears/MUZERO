export type GlobalSearchBestMatchKind = "set" | "track" | "lyric" | "album" | "artist" | "online";

export interface GlobalSearchBestMatchCandidate {
  key: string;
  kind: GlobalSearchBestMatchKind;
  order: number;
  score: number;
  recency?: number;
}

const TYPE_BIAS: Record<GlobalSearchBestMatchKind, number> = {
  album: 2,
  artist: 1,
  lyric: 6,
  online: 8,
  set: 2,
  track: 0,
};

export function rankGlobalSearchBestMatches<T extends GlobalSearchBestMatchCandidate>(
  candidates: readonly T[],
  limit = 5,
): T[] {
  const bestByKey = new Map<string, T>();
  for (const candidate of candidates) {
    const current = bestByKey.get(candidate.key);
    if (!current || compareBestMatch(candidate, current) < 0) {
      bestByKey.set(candidate.key, candidate);
    }
  }

  return [...bestByKey.values()].sort(compareBestMatch).slice(0, Math.max(0, limit));
}

function compareBestMatch(a: GlobalSearchBestMatchCandidate, b: GlobalSearchBestMatchCandidate) {
  return (
    adjustedScore(a) - adjustedScore(b) ||
    a.score - b.score ||
    (b.recency ?? 0) - (a.recency ?? 0) ||
    a.order - b.order
  );
}

function adjustedScore(candidate: GlobalSearchBestMatchCandidate): number {
  return candidate.score + TYPE_BIAS[candidate.kind];
}

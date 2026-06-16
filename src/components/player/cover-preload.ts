import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { getCroppedBlob } from "@/lib/image-crop";
import { coverUrlCache, type ObjectUrlCache } from "@/lib/object-url-cache";
import { proxyRemoteCover, trackCoverCacheKey } from "@/player/playback-preload";

export type CoverPreloadRole =
  | "current"
  | "next"
  | "previous"
  | "settle"
  | "stack-current"
  | "stack-next"
  | "stack-previous";

export type CoverPreloadCandidate = {
  role: CoverPreloadRole;
  track: Track | undefined;
};

export type CoverPreloadRequest = {
  coverBlobId?: string;
  crop?: Track["coverCrop"] | undefined;
  /** Proxied remote cover URL for streamed tracks (no local blob). */
  remoteUrl?: string;
  key: string;
  role: CoverPreloadRole;
  trackId: string;
};

export type PreloadedCover = {
  cacheKey?: string;
  key: string;
  url: string;
};

export type CoverPreloadStats = {
  cacheHits: number;
  canceled: number;
  created: number;
  cropped: number;
  inflightHits: number;
  local: number;
  maxSourceBytes: number;
  remote: number;
  requests: number;
  roleCurrent: number;
  roleNext: number;
  rolePrevious: number;
  roleSettle: number;
  roleStack: number;
  stale: number;
};

export type CoverPreloadBatchResult = {
  canceled: boolean;
  entries: Record<string, PreloadedCover>;
  stats: CoverPreloadStats;
};

type LocalCoverBlob = {
  blob: Blob;
  bytes: number;
  cropped: boolean;
};

type ResolveMediaBlob = typeof resolveMediaBlob;

const localCoverInflight = new Map<string, Promise<LocalCoverBlob | null>>();

export function buildCoverPreloadRequests(
  candidates: CoverPreloadCandidate[],
  // Crop is disabled — covers render from the original blob (Option A, switch-fps
  // cover-crop storm). Param kept so callers don't churn; intentionally unused.
  _coverCropped: boolean,
): CoverPreloadRequest[] {
  const seen = new Set<string>();
  const out: CoverPreloadRequest[] = [];
  for (const candidate of candidates) {
    const track = candidate.track;
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    if (track.coverBlobId) {
      const crop = undefined; // Option A: original blob, no main-thread canvas crop.
      const key = trackCoverCacheKey(track, false);
      if (!key) continue;
      out.push({
        coverBlobId: track.coverBlobId,
        crop,
        key,
        role: candidate.role,
        trackId: track.id,
      });
      continue;
    }
    if (track.remoteCoverUrl) {
      const url = proxyRemoteCover(track.remoteCoverUrl) ?? track.remoteCoverUrl;
      out.push({
        key: `${track.id}:remote:${track.remoteCoverUrl}`,
        remoteUrl: url,
        role: candidate.role,
        trackId: track.id,
      });
    }
  }
  return out;
}

export function filterCoverPreloadRequestsForBurst(
  requests: CoverPreloadRequest[],
  includeNonCurrentLocal: boolean,
): CoverPreloadRequest[] {
  if (includeNonCurrentLocal) return requests;
  return requests.filter((request) => request.role === "current" || !request.coverBlobId);
}

export async function preloadCoverBatch({
  cache = coverUrlCache,
  createObjectURL = (blob) => URL.createObjectURL(blob),
  delay = defaultDelay,
  isCurrent,
  localSettleMs = 0,
  nonCurrentLocalSettleMs = localSettleMs,
  previous,
  requests,
  resolveMediaBlob: resolveMediaBlobImpl = (id) => resolveMediaBlob(id, db),
  warmImage = defaultWarmImage,
}: {
  cache?: Pick<ObjectUrlCache, "acquire" | "peek" | "release" | "store">;
  createObjectURL?: (blob: Blob) => string;
  delay?: (ms: number) => Promise<void>;
  isCurrent: () => boolean;
  localSettleMs?: number;
  nonCurrentLocalSettleMs?: number;
  previous: Record<string, PreloadedCover>;
  requests: CoverPreloadRequest[];
  resolveMediaBlob?: ResolveMediaBlob;
  warmImage?: (url: string) => void;
}): Promise<CoverPreloadBatchResult> {
  const stats = initialStats(requests);
  const nextEntries: Record<string, PreloadedCover> = {};
  const acquiredKeys = new Set<string>();
  let currentLocalMissSettled = false;
  let nonCurrentLocalMissSettled = false;

  const cancel = (): CoverPreloadBatchResult => {
    stats.canceled = 1;
    for (const key of acquiredKeys) cache.release(key);
    return { canceled: true, entries: {}, stats };
  };

  for (const request of requests) {
    if (!isCurrent()) return cancel();
    const reusable = previous[request.trackId];
    if (reusable?.key === request.key) {
      nextEntries[request.trackId] = reusable;
      continue;
    }

    if (request.remoteUrl) {
      stats.remote += 1;
      warmImage(request.remoteUrl);
      nextEntries[request.trackId] = { key: request.key, url: request.remoteUrl };
      continue;
    }
    if (!request.coverBlobId) continue;
    stats.local += 1;

    const cachedUrl = cache.acquire(request.key);
    acquiredKeys.add(request.key);
    if (cachedUrl) {
      stats.cacheHits += 1;
      const entry = {
        cacheKey: request.key,
        key: request.key,
        url: cachedUrl,
      };
      nextEntries[request.trackId] = entry;
      continue;
    }

    const isCurrentRole = request.role === "current";
    const settleMs = isCurrentRole ? localSettleMs : nonCurrentLocalSettleMs;
    const localMissSettled = isCurrentRole ? currentLocalMissSettled : nonCurrentLocalMissSettled;
    if (!localMissSettled) {
      if (isCurrentRole) currentLocalMissSettled = true;
      else nonCurrentLocalMissSettled = true;
      if (settleMs > 0) await delay(settleMs);
      if (!isCurrent()) return cancel();
    }

    const existing = cache.peek(request.key);
    if (existing) {
      stats.cacheHits += 1;
      const entry = { cacheKey: request.key, key: request.key, url: existing };
      nextEntries[request.trackId] = entry;
      continue;
    }

    const coverBlob = await loadLocalCoverBlob(request, resolveMediaBlobImpl);
    if (!coverBlob) {
      cache.release(request.key);
      acquiredKeys.delete(request.key);
      continue;
    }
    stats.maxSourceBytes = Math.max(stats.maxSourceBytes, coverBlob.bytes);
    if (coverBlob.cropped) stats.cropped += 1;
    if (!isCurrent()) {
      stats.stale += 1;
      return cancel();
    }

    const afterInflight = cache.peek(request.key);
    const url = afterInflight ?? cache.store(request.key, createObjectURL(coverBlob.blob));
    if (!afterInflight) {
      stats.created += 1;
      // DECODE the freshly-created cover, not just hold its blob URL: a coverflow card
      // or the base <img> that mounts later then paints the cover on its FIRST frame
      // instead of showing bg-muted for a frame while the browser decodes (the "cover
      // flashes black on drag-start / commit"). Decoded bitmaps are cached per URL.
      warmImage(url);
    }
    const entry = { cacheKey: request.key, key: request.key, url };
    nextEntries[request.trackId] = entry;
  }

  return { canceled: false, entries: nextEntries, stats };

  async function loadLocalCoverBlob(
    request: CoverPreloadRequest,
    resolver: ResolveMediaBlob,
  ): Promise<LocalCoverBlob | null> {
    const inflight = localCoverInflight.get(request.key);
    if (inflight) {
      stats.inflightHits += 1;
      return inflight;
    }
    const promise = resolveLocalCoverBlob(request, resolver).finally(() => {
      localCoverInflight.delete(request.key);
    });
    localCoverInflight.set(request.key, promise);
    return promise;
  }
}

export function releasePreloadedCover(
  entry: PreloadedCover | undefined,
  cache: Pick<ObjectUrlCache, "release"> = coverUrlCache,
): void {
  if (entry?.cacheKey) cache.release(entry.cacheKey);
}

async function resolveLocalCoverBlob(
  request: CoverPreloadRequest,
  resolver: ResolveMediaBlob,
): Promise<LocalCoverBlob | null> {
  if (!request.coverBlobId) return null;
  const resolved = await resolver(request.coverBlobId, db);
  if (!resolved?.blob) return null;
  let blob = resolved.blob;
  const bytes = resolved.bytes ?? blob.size;
  let cropped = false;
  if (request.crop) {
    cropped = true;
    blob = await getCroppedBlob(blob, request.crop, blob.type || "image/jpeg");
  }
  return { blob, bytes, cropped };
}

function initialStats(requests: CoverPreloadRequest[]): CoverPreloadStats {
  const stats: CoverPreloadStats = {
    cacheHits: 0,
    canceled: 0,
    created: 0,
    cropped: 0,
    inflightHits: 0,
    local: 0,
    maxSourceBytes: 0,
    remote: 0,
    requests: requests.length,
    roleCurrent: 0,
    roleNext: 0,
    rolePrevious: 0,
    roleSettle: 0,
    roleStack: 0,
    stale: 0,
  };
  for (const request of requests) {
    switch (request.role) {
      case "current":
        stats.roleCurrent += 1;
        break;
      case "next":
        stats.roleNext += 1;
        break;
      case "previous":
        stats.rolePrevious += 1;
        break;
      case "settle":
        stats.roleSettle += 1;
        break;
      default:
        stats.roleStack += 1;
    }
  }
  return stats;
}

function defaultWarmImage(url: string): void {
  if (typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.referrerPolicy = "no-referrer";
  img.src = url;
  // Actually DECODE (off the main thread), not just fetch — so the decoded bitmap is
  // cached and a later <img> with this URL paints on its first frame. Ignore failures
  // (aborted/te decode races); the <img> falls back to its own lazy decode.
  void img.decode?.().catch(() => {});
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

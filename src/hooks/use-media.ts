import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureCoverThumbnailDerivative } from "@/db/cover-derivatives";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import { backfillCoverMetadata } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import {
  type CoverRenderSurface,
  noteCoverRenderCache,
  noteCoverWork,
} from "@/lib/cover-performance";
import { encodeCoverThumbhash } from "@/lib/cover-thumbhash";
import { getCroppedBlob } from "@/lib/image-crop";
import { log } from "@/lib/logger";
import { coverUrlCache } from "@/lib/object-url-cache";
import { arePerfCountersEnabled } from "@/lib/perf-counters";
import { proxyRemoteCover, trackCoverCacheKey } from "@/player/playback-preload";

export interface TrackCoverResource {
  /**
   * Display URL with the existing anti-flash behavior: while a local cover is
   * still resolving, this may temporarily be the previous cover's URL.
   */
  url: string | null;
  /** Stable identity of the current track's desired cover source. */
  targetKey: string | null;
  /** Stable identity of the returned URL; differs from targetKey only while stale. */
  urlKey: string | null;
  /** True when `url` is the held previous cover while the current local bytes resolve. */
  staleWhilePending: boolean;
  /** True when the returned URL belongs to the current track, or the track has no cover. */
  readyForTrack: boolean;
}

type TrackCoverInput = Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl"> &
  Partial<Pick<Track, "id">>;

/**
 * Create an object URL for a Blob and revoke it on change/unmount. Returns null
 * when there's no blob. Centralizes the revoke-before-replace lifecycle so we
 * never leak Blob URLs (matches the doodlekuma rule).
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  return useKeyedObjectUrl(blob, blob);
}

function useKeyedObjectUrl(blob: Blob | null | undefined, key: unknown): string | null {
  const [entry, setEntry] = useState<{ blob: Blob; key: unknown; url: string } | null>(null);
  useEffect(() => {
    if (!blob || key == null) {
      setEntry(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setEntry({ blob, key, url: next });
    return () => URL.revokeObjectURL(next);
  }, [blob, key]);
  return entry && entry.blob === blob && entry.key === key ? entry.url : null;
}

const blobIds = new WeakMap<Blob, number>();
let nextBlobId = 1;

function blobIdentityKey(blob: Blob): number {
  const existing = blobIds.get(blob);
  if (existing) return existing;
  const id = nextBlobId;
  nextBlobId += 1;
  blobIds.set(blob, id);
  return id;
}

/**
 * Object URLs for a list of Blobs, revoked together when the set changes. The
 * blobs' identity drives the effect, so a stable list won't re-create URLs.
 */
export function useObjectUrls(blobs: Blob[]): string[] {
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  const key = blobs.map(blobIdentityKey).join("|");
  const [urls, setUrls] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` represents the Blob identity sequence; `blobsRef` lets fresh arrays with the same blobs avoid URL churn.
  useEffect(() => {
    const next = blobsRef.current.map((b) => URL.createObjectURL(b));
    setUrls(next);
    return () => {
      for (const url of next) URL.revokeObjectURL(url);
    };
  }, [key]);
  return urls;
}

/**
 * Reactive object URL for a track's cover image (null if none). Applies the
 * stored square crop when the user's `coverCropped` setting is on — the crop is
 * rendered via canvas at display time, so the original blob is never modified.
 */
export function useTrackCoverUrl(
  track: TrackCoverInput | undefined,
  surface?: CoverRenderSurface,
): string | null {
  return useTrackCoverResource(track, surface).url;
}

export function useCoverDerivativeUrl(
  track: TrackCoverInput | undefined,
  kind: "thumbnail",
): string | null {
  const settings = useSettings();
  const trackId = track?.id;
  const coverBlobId = track?.coverBlobId;
  const remoteCoverUrl = track?.remoteCoverUrl;
  const coverCropped = settings.coverCropped ?? true;
  const cc = track?.coverCrop;
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on crop scalars so queue object identity churn does not regenerate derivatives.
  const crop = useMemo(
    () =>
      coverCropped && cc ? { x: cc.x, y: cc.y, width: cc.width, height: cc.height } : undefined,
    [coverCropped, cc?.x, cc?.y, cc?.width, cc?.height],
  );
  const cropX = crop?.x;
  const cropY = crop?.y;
  const cropWidth = crop?.width;
  const cropHeight = crop?.height;
  const [entry, setEntry] = useState<{ blob: Blob; key: string } | null>(null);
  useEffect(() => {
    if ((!trackId && !coverBlobId && !remoteCoverUrl) || kind !== "thumbnail") {
      setEntry(null);
      return;
    }
    let alive = true;
    void ensureCoverThumbnailDerivative({
      id: trackId ?? "",
      coverBlobId,
      coverCrop:
        cropX == null || cropY == null || cropWidth == null || cropHeight == null
          ? undefined
          : { height: cropHeight, width: cropWidth, x: cropX, y: cropY },
      remoteCoverUrl,
    }).then((resolved) => {
      if (!alive) return;
      setEntry(
        resolved
          ? {
              blob: resolved.blob,
              key: resolved.blobId,
            }
          : null,
      );
    });
    return () => {
      alive = false;
    };
  }, [kind, coverBlobId, remoteCoverUrl, trackId, cropX, cropY, cropWidth, cropHeight]);
  return useKeyedObjectUrl(entry?.blob, entry?.key);
}

/**
 * Reactive cover resource for a track. `url` preserves the existing
 * stale-while-pending behavior used by normal UI, while `readyForTrack` lets
 * animation handoffs wait until the visible base layer is actually rendering the
 * new track's cover rather than any truthy previous URL.
 */
export function useTrackCoverResource(
  track: TrackCoverInput | undefined,
  surface: CoverRenderSurface = "cover",
): TrackCoverResource {
  const settings = useSettings();
  const coverBlobId = track?.coverBlobId;
  const remoteCoverUrl = track?.remoteCoverUrl;
  const blob = useLiveQuery(
    async () => (coverBlobId ? ((await resolveMediaBlob(coverBlobId, db))?.blob ?? null) : null),
    [coverBlobId],
    undefined,
  );
  // Stabilize the crop by VALUE. The queue is a fresh array on any track edit
  // (e.g. liking another song), so `track.coverCrop`'s identity churns even when
  // unchanged — memoizing on scalars keeps the cropped object URL stable, so the
  // <img> never reloads and the dock cover never re-animates on unrelated edits.
  const coverCropped = settings.coverCropped ?? true;
  const cc = track?.coverCrop;
  // biome-ignore lint/correctness/useExhaustiveDependencies: depend on scalars, not the object, so identity stays stable across queue rebuilds
  const crop = useMemo(
    () =>
      coverCropped && cc ? { x: cc.x, y: cc.y, width: cc.width, height: cc.height } : undefined,
    [coverCropped, cc?.x, cc?.y, cc?.width, cc?.height],
  );
  // A stable cache key built entirely from ROW fields (no async): the codename-
  // stable blob id, plus the crop signature when a square crop applies. Distinct
  // crops are distinct entries, mirroring the old cropped/original URL split.
  const cacheKey = trackCoverCacheKey(
    {
      coverBlobId,
      coverCrop: crop,
    },
    true,
  );

  // Ref-count this key for the mount's lifetime so the cache never revokes a URL
  // a visible <img> still points at (see ObjectUrlCache).
  useEffect(() => {
    if (!cacheKey) return;
    coverUrlCache.acquire(cacheKey);
    return () => coverUrlCache.release(cacheKey);
  }, [cacheKey]);

  // On a cache MISS, resolve the blob (+ optional crop) → object URL → publish to
  // the cache. `resolved` is only a re-render trigger; the cache is the source of
  // truth. We never revoke on cleanup — the cache owns each URL's lifetime, which
  // is what lets a cover survive unmount and re-appear instantly on the next tab
  // visit (instant-cover-thumbnails PRD, Phase 1).
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!cacheKey) {
      setResolved(null);
      return;
    }
    const hit = coverUrlCache.get(cacheKey);
    if (hit) {
      noteCoverRenderCache("cache-hit", surface, {
        cropped: Boolean(crop),
        sourceKey: cacheKey,
        sourceKind: "local-cover",
        trackId: track?.id,
      });
      setResolved({ key: cacheKey, url: hit });
      return;
    }
    if (blob === undefined) return; // bytes not resolved yet — re-runs when the liveQuery emits
    if (!blob) {
      setResolved(null);
      return;
    }
    noteCoverRenderCache("cache-miss", surface, {
      cropped: Boolean(crop),
      sourceKey: cacheKey,
      sourceKind: "local-cover",
      trackId: track?.id,
    });
    let alive = true;
    void (async () => {
      const shouldTrace = arePerfCountersEnabled();
      const startedAt = shouldTrace ? performance.now() : 0;
      const out = crop ? await getCroppedBlob(blob, crop, blob.type || "image/jpeg") : blob;
      if (!alive) return;
      const created = URL.createObjectURL(out);
      const url = coverUrlCache.store(cacheKey, created); // dedupes + revokes a late dup
      if (shouldTrace) {
        noteCoverWork("cover.render.object-url-miss", startedAt, {
          bytes: out.size,
          cropped: Boolean(crop),
          mime: out.type || blob.type || "image/jpeg",
          surface,
        });
      }
      setResolved({ key: cacheKey, url });
    })();
    return () => {
      alive = false;
    };
  }, [cacheKey, blob, crop, surface, track?.id]);

  // Synchronous read: a cache hit returns the URL on frame 0 — instant on a
  // re-mount, zero placeholder flash. `peek` doesn't mutate, so it's render-safe.
  const cached = cacheKey ? coverUrlCache.peek(cacheKey) : undefined;
  const resolvedUrl = cached ?? (resolved?.key === cacheKey ? resolved.url : undefined);
  const remoteUrl = proxyExternalCover(remoteCoverUrl);
  const currentUrl = resolvedUrl ?? remoteUrl;
  const remoteKey = remoteUrl ? `remote:${remoteUrl}` : null;
  const currentKey = resolvedUrl ? cacheKey : remoteUrl ? remoteKey : null;
  const targetKey = cacheKey ?? remoteKey;
  const lastCommittedUrl = useRef<{ key: string | null; url: string } | null>(null);
  useEffect(() => {
    if (currentUrl) {
      lastCommittedUrl.current = { key: currentKey, url: currentUrl };
    } else if (!coverBlobId && !remoteCoverUrl) {
      lastCommittedUrl.current = null;
    }
  }, [currentKey, currentUrl, coverBlobId, remoteCoverUrl]);
  const pendingLocalCover = Boolean(coverBlobId) && blob === undefined && !currentUrl;
  const staleFallback = pendingLocalCover ? lastCommittedUrl.current : null;
  const url = currentUrl ?? staleFallback?.url ?? null;
  const urlKey = currentKey ?? staleFallback?.key ?? null;
  const staleWhilePending = !currentUrl && Boolean(staleFallback);
  const hasCover = Boolean(coverBlobId || remoteCoverUrl);

  return {
    readyForTrack: !track || !hasCover || Boolean(currentUrl),
    staleWhilePending,
    targetKey,
    url,
    urlKey,
  };
}

/**
 * Route an external (http) cover through the media proxy so the response carries
 * `ACAO:*` — needed for the WebAudio/Pixi(WebGL) backgrounds to use a cross-origin
 * cover as a texture without tainting. Blob/same-origin URLs and shells without a
 * media proxy (web/tauri) pass through unchanged.
 */
export function proxyExternalCover(url: string | undefined): string | null {
  return proxyRemoteCover(url);
}

/**
 * Reactive object URL for a DERIVED entity's cover (one artist / album). Resolves
 * a user-chosen override (the `entityCovers` row keyed by the projection key)
 * first, then falls back to the given track's cover (today's behavior — the first
 * member track that has art). Reuses {@link useTrackCoverUrl} for the crop +
 * object-URL lifecycle by feeding the override through the same shape.
 */
export function useEntityCoverUrl(
  entityKey: string | undefined,
  fallbackTrack: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl"> | undefined,
): string | null {
  const override = useLiveQuery(
    async () => (entityKey ? ((await db.entityCovers.get(entityKey)) ?? null) : null),
    [entityKey],
    null,
  );
  // Both calls are unconditional (hook rules); only one result is returned. A
  // local override crops its own blob; a remote-backed (imported) override has no
  // local bytes to crop, so it shows the full image via `remoteCoverUrl`.
  const overrideUrl = useTrackCoverUrl(
    override
      ? {
          coverBlobId: override.coverBlobId,
          coverCrop: override.coverBlobId ? override.crop : undefined,
          remoteCoverUrl: override.remoteCover?.url,
        }
      : undefined,
  );
  const fallbackUrl = useTrackCoverUrl(fallbackTrack);
  return override ? overrideUrl : fallbackUrl;
}

/** Reactive object URL for a track's primary audio/video media bytes. */
export function useTrackMediaUrl(
  track: Pick<Track, "blobId" | "remoteMediaUrl"> | undefined,
): string | null {
  const blobId = track?.blobId;
  const remoteMediaUrl = track?.remoteMediaUrl;
  const blob = useLiveQuery(
    async () => (blobId ? (await resolveMediaBlob(blobId, db))?.blob : undefined),
    [blobId],
    undefined,
  );
  return useKeyedObjectUrl(blob, blobId) ?? remoteMediaUrl ?? null;
}

// Session-wide guards for the lazy cover metadata backfill (module scope, not store
// state — see CLAUDE.md rule 6): run the pass once, and remember which cover
// blobs we've already attempted so the loop converges (un-encodable ones aren't
// retried forever).
let coverMetadataBackfillRunning = false;
const coverMetadataBackfillSkip = new Set<string>();
const COVER_METADATA_BACKFILL_BATCH_LIMIT = 2;
const COVER_METADATA_BACKFILL_INITIAL_DELAY_MS = 2500;
const COVER_METADATA_BACKFILL_NEXT_DELAY_MS = 2000;
const COVER_METADATA_BACKFILL_IDLE_TIMEOUT_MS = 5000;

/**
 * Lazily generate cover metadata for legacy/imported covers: thumbhash previews
 * plus persistent palette metadata for visualizers. Runs only while the gallery
 * is mounted, in small idle batches, so a legacy library can heal itself without
 * turning the gallery tab into a background batch job.
 */
export function useCoverMetadataBackfill(): void {
  useEffect(() => {
    if (coverMetadataBackfillRunning) return;
    coverMetadataBackfillRunning = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;

    const schedule = (fn: () => void, delayMs: number) => {
      timer = setTimeout(() => {
        timer = undefined;
        if (cancelled) return;
        if (typeof requestIdleCallback === "function") {
          idleId = requestIdleCallback(
            () => {
              idleId = undefined;
              if (!cancelled) fn();
            },
            { timeout: COVER_METADATA_BACKFILL_IDLE_TIMEOUT_MS },
          );
          return;
        }
        fn();
      }, delayMs);
    };
    const tick = async () => {
      try {
        const { attempted } = await backfillCoverMetadata(db, {
          encode: encodeCoverThumbhash,
          limit: COVER_METADATA_BACKFILL_BATCH_LIMIT,
          skip: coverMetadataBackfillSkip,
        });
        for (const id of attempted) coverMetadataBackfillSkip.add(id);
        if (!cancelled && attempted.length > 0) {
          schedule(() => void tick(), COVER_METADATA_BACKFILL_NEXT_DELAY_MS);
          return;
        }
        coverMetadataBackfillRunning = false;
      } catch (err) {
        coverMetadataBackfillRunning = false;
        log.debug("cover metadata backfill stopped", err);
      }
    };
    schedule(() => void tick(), COVER_METADATA_BACKFILL_INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      coverMetadataBackfillRunning = false;
      if (timer) clearTimeout(timer);
      if (idleId !== undefined && typeof cancelIdleCallback === "function") {
        cancelIdleCallback(idleId);
      }
    };
  }, []);
}

/** @deprecated Use {@link useCoverMetadataBackfill}; kept for older imports. */
export function useCoverThumbhashBackfill(): void {
  useCoverMetadataBackfill();
}

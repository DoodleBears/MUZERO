import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  coverImageDerivativeKey,
  ensureCoverBacklightDerivative,
  ensureCoverThumbnailDerivative,
} from "@/db/cover-derivatives";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import { backfillCoverMetadata } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { getOrFetchRemoteCoverAsset, remoteCoverAssetKey } from "@/lib/cover-asset";
import { hasCoverUrlDecoded } from "@/lib/cover-decode-registry";
import {
  type CoverRenderSurface,
  noteCoverRenderCache,
  noteCoverWork,
} from "@/lib/cover-performance";
import { encodeCoverThumbhash } from "@/lib/cover-thumbhash";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { getCroppedBlob } from "@/lib/image-crop";
import { log } from "@/lib/logger";
import { coverDerivativeUrlCache, coverUrlCache } from "@/lib/object-url-cache";
import { arePerfCountersEnabled } from "@/lib/perf-counters";
import { proxyRemoteCover, trackCoverCacheKey } from "@/player/playback-preload";

const DISABLE_COVER_RESOURCES_FOR_BISECT = false;

/**
 * Experiment (cover-quality-and-scroll): render gallery grid cards (sets / albums
 * / artists) from the full-resolution ORIGINAL cover instead of the 160px
 * `thumbnail` derivative, to measure the JS-heap / decode cost on a local-first
 * app. A source constant in the spirit of `DISABLE_COVER_RESOURCES_FOR_BISECT`
 * (flip to false + rebuild to revert — NOT a runtime flag, CLAUDE.md rule 3). The
 * dev perf HUD's `performance.frame` trace (`heapMb` + `blobsLiveByKind.image`)
 * captures the before/after delta while the gallery tab is open.
 */
export const GRID_USE_ORIGINAL_COVER = true;

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
  kind: "backlight" | "thumbnail",
  options?: { defer?: boolean },
): string | null {
  const effectiveTrack = DISABLE_COVER_RESOURCES_FOR_BISECT ? undefined : track;
  const defer = options?.defer ?? false;
  const settings = useSettings();
  const trackId = effectiveTrack?.id;
  const coverBlobId = effectiveTrack?.coverBlobId;
  const remoteCoverUrl = effectiveTrack?.remoteCoverUrl;
  const coverCropped = settings.coverCropped ?? true;
  const cc = effectiveTrack?.coverCrop;
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
  // Row-derived, synchronous cache key = the `cvd_…` id the resolver lands on.
  // Lets a re-mount peek the cross-mount cache on frame 0 (no placeholder flash),
  // exactly like useTrackCoverResource does for full covers. Null for remote-only
  // covers (no local derivative) — those fall through to proxyExternalCover above.
  const cacheKey = useMemo(
    () => coverImageDerivativeKey({ coverBlobId, coverCrop: crop, remoteCoverUrl }, kind),
    [coverBlobId, crop, remoteCoverUrl, kind],
  );

  // Ref-count for the mount's lifetime so the cache never revokes a URL a visible
  // <img> still points at; the URL outlives unmount, ready for the next mount.
  useEffect(() => {
    if (!cacheKey) return;
    coverDerivativeUrlCache.acquire(cacheKey);
    return () => coverDerivativeUrlCache.release(cacheKey);
  }, [cacheKey]);

  // Re-render trigger after the async resolve+store. The cache is the source of
  // truth (read via peek below); this just nudges the commit on a miss→hit.
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!cacheKey) {
      setResolved(null);
      return;
    }
    // Already cached (a prior mount, or a sibling consumer that shared the in-flight
    // resolve)? The render-time peek returns it — nothing to do, no re-decode. This
    // is also what makes a scroll STOP (defer flips false) a no-op for on-screen
    // covers instead of re-running ensure() and blinking the thumbhash.
    if (coverDerivativeUrlCache.peek(cacheKey)) return;
    // While the list is scrolling, don't start expensive derivative work for a
    // freshly-recycled row — it shows its thumbhash placeholder until scroll settles.
    if (defer) return;
    let alive = true;
    const ensure =
      kind === "backlight" ? ensureCoverBacklightDerivative : ensureCoverThumbnailDerivative;
    void ensure({
      id: trackId ?? "",
      coverBlobId,
      coverCrop:
        cropX == null || cropY == null || cropWidth == null || cropHeight == null
          ? undefined
          : { height: cropHeight, width: cropWidth, x: cropX, y: cropY },
      remoteCoverUrl,
    }).then((res) => {
      if (!alive || !res) return;
      // Publish to the cache (dedupes + revokes a late duplicate). Never revoked on
      // cleanup — the cache owns each URL's lifetime, which is what survives unmount.
      const url = coverDerivativeUrlCache.store(cacheKey, URL.createObjectURL(res.blob));
      setResolved({ key: cacheKey, url });
    });
    return () => {
      alive = false;
    };
  }, [
    cacheKey,
    defer,
    kind,
    coverBlobId,
    remoteCoverUrl,
    trackId,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
  ]);

  // Synchronous read: a cache hit returns the URL on frame 0 — instant on re-mount,
  // zero placeholder flash. peek doesn't mutate, so it's render-safe.
  const cached = cacheKey ? coverDerivativeUrlCache.peek(cacheKey) : undefined;
  const local = cached ?? (resolved?.key === cacheKey ? resolved.url : null);
  if (local) return local;
  // Remote-only cover (streamed track): no local derivative exists — `ensureCover…`
  // early-outs for non-local sources, so `cacheKey` is null and there's no `cvd_…` blob
  // to resolve. Fall back to the directly-displayable proxied/raw remote URL (same as
  // useTrackThumbnailUrl) so surfaces that call this hook DIRECTLY (e.g. the track-row
  // list thumbnail) show the cover instead of being stuck on the thumbhash. An <img>
  // loads a cross-origin URL without CORS — only fetch()→blob (the derivative path) needs
  // it.
  if (!coverBlobId && remoteCoverUrl) {
    const proxied = proxyExternalCover(remoteCoverUrl);
    // A remote cover that has ALREADY painted once stays visible while the virtualized
    // list scrolls — mirroring how a local cover's object-URL cache hit is returned even
    // under `defer`. Only a never-seen remote cover defers, so a fast fling doesn't blank
    // the rows it already loaded (the "封面滚动时消失、停下又出现" report) yet still avoids
    // firing a fetch per row for covers flung past.
    if (defer && !(proxied && hasCoverUrlDecoded(proxied))) return null;
    return proxied;
  }
  return null;
}

export function useTrackThumbnailUrl(track: TrackCoverInput | undefined): string | null {
  const effectiveTrack = DISABLE_COVER_RESOURCES_FOR_BISECT ? undefined : track;
  const localThumbnailUrl = useCoverDerivativeUrl(
    effectiveTrack?.coverBlobId ? effectiveTrack : undefined,
    "thumbnail",
  );
  if (!effectiveTrack) return null;
  if (effectiveTrack.coverBlobId) return localThumbnailUrl;
  return proxyExternalCover(effectiveTrack.remoteCoverUrl);
}

/**
 * Cover URL for a gallery grid card. Normally the 160px `thumbnail` derivative
 * (same as {@link useTrackThumbnailUrl}); under the {@link GRID_USE_ORIGINAL_COVER}
 * experiment, the full-resolution original (square-cropped at display time). Both
 * hooks are called unconditionally to satisfy the rules of hooks; the unused one
 * receives `undefined` so it does no resolve work. `isGrid` lets a list-view card
 * stay on the cheap thumbnail so the experiment is isolated to the grid.
 */
export function useGridCoverUrl(track: TrackCoverInput | undefined, isGrid = true): string | null {
  const useOriginal = GRID_USE_ORIGINAL_COVER && isGrid;
  const originalUrl = useTrackCoverUrl(useOriginal ? track : undefined);
  const thumbnailUrl = useTrackThumbnailUrl(useOriginal ? undefined : track);
  return useOriginal ? originalUrl : thumbnailUrl;
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
  const effectiveTrack = DISABLE_COVER_RESOURCES_FOR_BISECT ? undefined : track;
  const coverBlobId = effectiveTrack?.coverBlobId;
  const remoteCoverUrl = effectiveTrack?.remoteCoverUrl;
  const resolvedCover = useLiveQuery(
    async () => (coverBlobId ? ((await resolveMediaBlob(coverBlobId, db)) ?? null) : null),
    [coverBlobId],
    undefined,
  );
  const blob =
    !coverBlobId || resolvedCover === null
      ? null
      : resolvedCover === undefined
        ? undefined
        : resolvedCover.id === coverBlobId
          ? resolvedCover.blob
          : undefined;
  // Option A (switch-fps cover-crop storm): render the cover from the ORIGINAL
  // blob — never main-thread canvas-crop it. getCroppedBlob (decode → drawImage →
  // re-encode) ran per cache-miss on every surface, and a cover edit churns the
  // keys, so it tanked to ~16fps. The <img>'s object-fit:cover handles the visual
  // fit; per-cover crop POSITIONING is dropped (coverCrop stays in the DB, unused).
  const crop = undefined;
  // Cache key = the codename-stable blob id only (no crop variants → fewer entries,
  // higher hit-rate, and matches the preload/warm keys which also drop crop).
  const cacheKey = trackCoverCacheKey({ coverBlobId, coverCrop: crop }, false);
  const remoteCacheKey =
    !coverBlobId && remoteCoverUrl ? remoteCoverAssetKey(remoteCoverUrl) : null;
  const targetKey = cacheKey ?? remoteCacheKey;

  // Ref-count this key for the mount's lifetime so the cache never revokes a URL
  // a visible <img> still points at (see ObjectUrlCache).
  useEffect(() => {
    if (!cacheKey) return;
    coverUrlCache.acquire(cacheKey);
    return () => coverUrlCache.release(cacheKey);
  }, [cacheKey]);
  useEffect(() => {
    if (!remoteCacheKey) return;
    coverUrlCache.acquire(remoteCacheKey);
    return () => coverUrlCache.release(remoteCacheKey);
  }, [remoteCacheKey]);

  // On a cache MISS, resolve the blob (+ optional crop) → object URL → publish to
  // the cache. `resolved` is only a re-render trigger; the cache is the source of
  // truth. We never revoke on cleanup — the cache owns each URL's lifetime, which
  // is what lets a cover survive unmount and re-appear instantly on the next tab
  // visit (instant-cover-thumbnails PRD, Phase 1).
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
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
        trackId: effectiveTrack?.id,
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
      trackId: effectiveTrack?.id,
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
  }, [cacheKey, blob, surface, effectiveTrack?.id]);

  useEffect(() => {
    if (!remoteCacheKey || !remoteCoverUrl) return;
    const hit = coverUrlCache.get(remoteCacheKey);
    if (hit) {
      setFailedKey(null);
      setResolved({ key: remoteCacheKey, url: hit });
      return;
    }
    let alive = true;
    setFailedKey(null);
    void (async () => {
      try {
        const asset = await getOrFetchRemoteCoverAsset(remoteCoverUrl);
        if (!alive) return;
        const url = coverUrlCache.store(remoteCacheKey, URL.createObjectURL(asset.blob));
        if (alive) setResolved({ key: remoteCacheKey, url });
      } catch (error) {
        if (!alive) return;
        setResolved((current) => (current?.key === remoteCacheKey ? null : current));
        setFailedKey(remoteCacheKey);
        log.warn("cover", "remote cover display cache failed", {
          error: error instanceof Error ? error.message : String(error),
          trackId: effectiveTrack?.id,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [remoteCacheKey, remoteCoverUrl, effectiveTrack?.id]);

  // Synchronous read: a cache hit returns the URL on frame 0 — instant on a
  // re-mount, zero placeholder flash. `peek` doesn't mutate, so it's render-safe.
  const cached = targetKey ? coverUrlCache.peek(targetKey) : undefined;
  const resolvedUrl = cached ?? (resolved?.key === targetKey ? resolved.url : undefined);
  const currentUrl = resolvedUrl ?? null;
  const currentKey = currentUrl ? targetKey : null;
  const lastCommittedUrl = useRef<{ key: string | null; url: string } | null>(null);
  useEffect(() => {
    if (currentUrl) {
      lastCommittedUrl.current = { key: currentKey, url: currentUrl };
    } else if (!coverBlobId && !remoteCoverUrl) {
      lastCommittedUrl.current = null;
    }
  }, [currentKey, currentUrl, coverBlobId, remoteCoverUrl]);
  const remoteBackedCover = Boolean(remoteCoverUrl);
  const pendingLocalCover =
    Boolean(coverBlobId) && !remoteBackedCover && blob === undefined && !currentUrl;
  const staleFallback = pendingLocalCover ? lastCommittedUrl.current : null;
  const hasCover = Boolean(coverBlobId || remoteCoverUrl);
  const remoteFailed = Boolean(targetKey && failedKey === targetKey);
  const remoteBackedLocalUnavailable = Boolean(coverBlobId && remoteCoverUrl && !currentUrl);
  // When the blob fetch can't deliver the bytes — chiefly on the WEB shell, where there's
  // no `muzfetch://` proxy so a cross-origin R2 cover fails CORS on `fetch()` — fall back
  // to the directly-displayable proxied/raw URL. An <img>/canvas loads a cross-origin
  // image without CORS (it just can't be read back or used as a clean WebGL texture), so
  // the cover at least SHOWS instead of falling through to the thumbhash / a blank stage.
  // Electron keeps using the fetched blob (clean texture); this only engages on failure.
  const remoteDisplayFallback =
    !coverBlobId && remoteCoverUrl && remoteFailed ? proxyExternalCover(remoteCoverUrl) : null;
  const url = currentUrl ?? remoteDisplayFallback ?? staleFallback?.url ?? null;
  const urlKey =
    currentKey ?? (remoteDisplayFallback ? targetKey : null) ?? staleFallback?.key ?? null;
  const staleWhilePending = !currentUrl && !remoteDisplayFallback && Boolean(staleFallback);

  return {
    readyForTrack:
      !effectiveTrack ||
      !hasCover ||
      Boolean(currentUrl) ||
      remoteFailed ||
      remoteBackedLocalUnavailable,
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
  const effectiveEntityKey = DISABLE_COVER_RESOURCES_FOR_BISECT ? undefined : entityKey;
  const effectiveFallbackTrack = DISABLE_COVER_RESOURCES_FOR_BISECT ? undefined : fallbackTrack;
  const override = useLiveQuery(
    async () =>
      effectiveEntityKey ? ((await db.entityCovers.get(effectiveEntityKey)) ?? null) : null,
    [effectiveEntityKey],
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
  const fallbackUrl = useTrackCoverUrl(effectiveFallbackTrack);
  return override ? overrideUrl : fallbackUrl;
}

/** Reactive object URL for a track's primary audio/video media bytes. */
export function useTrackMediaUrl(
  track:
    | (Pick<Track, "blobId" | "remoteMediaUrl"> &
        Partial<Pick<Track, "kind" | "mediaMetadata" | "sourcePath">>)
    | undefined,
): string | null {
  const blobId = track?.blobId;
  const remoteMediaUrl = track?.remoteMediaUrl;
  const sourcePath = track?.sourcePath;
  const localFileMime =
    track?.mediaMetadata?.originalMime ?? (track?.kind === "video" ? "video/mp4" : "audio/mpeg");
  const blob = useLiveQuery(
    async () => (blobId ? (await resolveMediaBlob(blobId, db))?.blob : undefined),
    [blobId],
    undefined,
  );
  const localFileUrl = useLocalFileMediaUrl(sourcePath, localFileMime);
  return useKeyedObjectUrl(blob, blobId) ?? localFileUrl ?? remoteMediaUrl ?? null;
}

function useLocalFileMediaUrl(
  sourcePath: string | undefined,
  mime: string | undefined,
): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!sourcePath) {
      setUrl(null);
      return;
    }
    const bridge = resolveDesktopBridge();
    if (!bridge.localMediaUrl) {
      setUrl(null);
      return;
    }
    let alive = true;
    void bridge
      .localMediaUrl({ path: sourcePath, mime })
      .then((next) => {
        if (alive) setUrl(next);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        log.warn("media", "failed to resolve local media url", {
          error: error instanceof Error ? error.name : typeof error,
        });
        setUrl(null);
      });
    return () => {
      alive = false;
    };
  }, [sourcePath, mime]);
  return url;
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

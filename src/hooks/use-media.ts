import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveMediaBlob } from "@/db/media-blob-storage";
import { db } from "@/db/muzero-db";
import { backfillCoverThumbhashes } from "@/db/repositories";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { encodeCoverThumbhash } from "@/lib/cover-thumbhash";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { getCroppedBlob } from "@/lib/image-crop";
import { log } from "@/lib/logger";
import { coverUrlCache } from "@/lib/object-url-cache";

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
  track: Pick<Track, "coverBlobId" | "coverCrop" | "remoteCoverUrl"> | undefined,
): string | null {
  const settings = useSettings();
  const coverBlobId = track?.coverBlobId;
  const remoteCoverUrl = track?.remoteCoverUrl;
  const blob = useLiveQuery(
    async () => (coverBlobId ? (await resolveMediaBlob(coverBlobId, db))?.blob : undefined),
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
  const cacheKey = coverBlobId
    ? crop
      ? `${coverBlobId}:${crop.x},${crop.y},${crop.width},${crop.height}`
      : coverBlobId
    : null;

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
      setResolved({ key: cacheKey, url: hit });
      return;
    }
    if (!blob) return; // bytes not resolved yet — re-runs when the liveQuery emits
    let alive = true;
    void (async () => {
      const out = crop ? await getCroppedBlob(blob, crop, blob.type || "image/jpeg") : blob;
      if (!alive) return;
      const created = URL.createObjectURL(out);
      const url = coverUrlCache.store(cacheKey, created); // dedupes + revokes a late dup
      setResolved({ key: cacheKey, url });
    })();
    return () => {
      alive = false;
    };
  }, [cacheKey, blob, crop]);

  // Synchronous read: a cache hit returns the URL on frame 0 — instant on a
  // re-mount, zero placeholder flash. `peek` doesn't mutate, so it's render-safe.
  const cached = cacheKey ? coverUrlCache.peek(cacheKey) : undefined;
  const url = cached ?? (resolved?.key === cacheKey ? resolved.url : undefined);
  return url ?? proxyExternalCover(remoteCoverUrl);
}

/**
 * Route an external (http) cover through the media proxy so the response carries
 * `ACAO:*` — needed for the WebAudio/Pixi(WebGL) backgrounds to use a cross-origin
 * cover as a texture without tainting. Blob/same-origin URLs and shells without a
 * media proxy (web/tauri) pass through unchanged.
 */
export function proxyExternalCover(url: string | undefined): string | null {
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) return url;
  return resolveDesktopBridge().mediaProxyUrl?.(url) ?? url;
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

// Session-wide guards for the lazy thumbhash backfill (module scope, not store
// state — see CLAUDE.md rule 6): run the pass once, and remember which cover
// blobs we've already attempted so the loop converges (un-encodable ones aren't
// retried forever).
let coverThumbhashBackfillStarted = false;
const coverThumbhashBackfillSkip = new Set<string>();

/**
 * Lazily generate thumbhashes for legacy/imported covers that predate the feature
 * (instant-cover-thumbnails PRD Phase 3). Runs once per session, a few covers per
 * idle tick, until none remain — so an existing library "fills in" its blurred
 * previews in the background without janking the gallery. Call from a long-lived
 * surface (the gallery page). Off the render path; failures are swallowed.
 */
export function useCoverThumbhashBackfill(): void {
  useEffect(() => {
    if (coverThumbhashBackfillStarted) return;
    coverThumbhashBackfillStarted = true;
    const schedule = (fn: () => void) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(fn, { timeout: 2000 });
      else setTimeout(fn, 500);
    };
    const tick = async () => {
      try {
        const { attempted } = await backfillCoverThumbhashes(db, encodeCoverThumbhash, {
          limit: 6,
          skip: coverThumbhashBackfillSkip,
        });
        for (const id of attempted) coverThumbhashBackfillSkip.add(id);
        if (attempted.length > 0) schedule(() => void tick()); // more remain → keep going
      } catch (err) {
        log.debug("cover thumbhash backfill stopped", err);
      }
    };
    schedule(() => void tick());
  }, []);
}

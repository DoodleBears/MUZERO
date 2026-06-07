import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "@/db/muzero-db";
import type { Track } from "@/db/types";
import { useSettings } from "@/hooks/use-app-data";
import { getCroppedBlob } from "@/lib/image-crop";

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
  track: Pick<Track, "coverBlobId" | "coverCrop"> | undefined,
): string | null {
  const settings = useSettings();
  const coverBlobId = track?.coverBlobId;
  const blob = useLiveQuery(
    async () => (coverBlobId ? (await db.mediaBlobs.get(coverBlobId))?.blob : undefined),
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
  const cropKey =
    coverBlobId && crop ? `${coverBlobId}:${crop.x},${crop.y},${crop.width},${crop.height}` : null;

  // Cropped render (canvas → object URL). Only runs when a crop applies.
  const [croppedEntry, setCroppedEntry] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!blob || !crop || !cropKey) {
      setCroppedEntry(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    void getCroppedBlob(blob, crop, blob.type || "image/jpeg").then((out) => {
      if (!alive) return;
      url = URL.createObjectURL(out);
      setCroppedEntry({ key: cropKey, url });
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, crop, cropKey]);

  // Original URL only when no crop applies (avoids a redundant object URL).
  const originalUrl = useKeyedObjectUrl(crop ? null : blob, crop ? null : coverBlobId);
  return crop ? (croppedEntry?.key === cropKey ? croppedEntry.url : null) : originalUrl;
}

/** Reactive object URL for a track's primary audio/video media bytes. */
export function useTrackMediaUrl(track: Pick<Track, "blobId"> | undefined): string | null {
  const blobId = track?.blobId;
  const blob = useLiveQuery(
    async () => (blobId ? (await db.mediaBlobs.get(blobId))?.blob : undefined),
    [blobId],
    undefined,
  );
  return useKeyedObjectUrl(blob, blobId);
}

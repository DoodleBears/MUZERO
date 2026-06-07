import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
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
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/**
 * Object URLs for a list of Blobs, revoked together when the set changes. The
 * blobs' identity drives the effect, so a stable list won't re-create URLs.
 */
export function useObjectUrls(blobs: Blob[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = blobs.map((b) => URL.createObjectURL(b));
    setUrls(next);
    return () => {
      for (const url of next) URL.revokeObjectURL(url);
    };
    // Re-run when the blob set changes (length is a cheap, stable-enough proxy
    // since blobs are appended/removed, never mutated in place).
  }, [blobs]);
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

  // Cropped render (canvas → object URL). Only runs when a crop applies.
  const [croppedUrl, setCroppedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || !crop) {
      setCroppedUrl(null);
      return;
    }
    let alive = true;
    let url: string | null = null;
    void getCroppedBlob(blob, crop, blob.type || "image/jpeg").then((out) => {
      if (!alive) return;
      url = URL.createObjectURL(out);
      setCroppedUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [blob, crop]);

  // Original URL only when no crop applies (avoids a redundant object URL).
  const originalUrl = useObjectUrl(crop ? null : blob);
  return crop ? croppedUrl : originalUrl;
}

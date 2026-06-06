import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { getTrackCover } from "@/db/repositories";
import type { Track } from "@/db/types";

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

/** Reactive object URL for a track's cover image (null if none). */
export function useTrackCoverUrl(track: Track | undefined): string | null {
  const blob = useLiveQuery(
    async () => (track?.coverBlobId ? (await getTrackCover(track))?.blob : undefined),
    [track?.coverBlobId],
    undefined,
  );
  return useObjectUrl(blob);
}

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "@/db/muzero-db";
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
import { canServeLocalCover } from "@/lib/local-cover";

/**
 * storageKey → stable `muzfetch://local-media` URL. Resolved once per key (the
 * token is reused) so the URL is stable and Chromium caches the decoded image by
 * it. A string once resolved; a Promise while the token IPC is in flight.
 */
const localCoverUrlCache = new Map<string, Promise<string> | string>();

function ensureLocalCoverUrl(storageKey: string, mime: string): Promise<string> | string | null {
  const hit = localCoverUrlCache.get(storageKey);
  if (hit) return hit;
  const build = resolveDesktopBridge().localMediaUrlForStorageKey;
  if (!build) return null;
  const promise = build({ storageKey, mime }).then((url) => {
    localCoverUrlCache.set(storageKey, url);
    return url;
  });
  localCoverUrlCache.set(storageKey, promise);
  return promise;
}

/**
 * On Electron with a file-backed cover, the local-media protocol URL an `<img>`
 * loads natively — no blob load, no `URL.createObjectURL`, no bitmap held in the
 * JS heap (the cover-decode churn the switch-jank trace exposed). Returns null
 * everywhere else (web/tauri, or OPFS/IndexedDB-backed covers), so the caller
 * falls back to the object-URL cover. See the electron-local-media-protocol PRD.
 */
export function useLocalCoverUrl(track: { coverBlobId?: string } | undefined): string | null {
  const coverBlobId = track?.coverBlobId;
  const row = useLiveQuery(
    async () => (coverBlobId ? await db.mediaBlobs.get(coverBlobId) : undefined),
    [coverBlobId],
    undefined,
  );
  const storageBackend = row?.storageBackend;
  const storageKey = row?.storageKey;
  const mime = row?.mime;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey || !canServeLocalCover({ storageBackend, storageKey })) {
      setUrl(null);
      return;
    }
    const result = ensureLocalCoverUrl(storageKey, mime ?? "image/jpeg");
    if (result == null) {
      setUrl(null);
      return;
    }
    if (typeof result === "string") {
      setUrl(result);
      return;
    }
    let alive = true;
    void result.then((u) => alive && setUrl(u)).catch(() => alive && setUrl(null));
    return () => {
      alive = false;
    };
  }, [storageBackend, storageKey, mime]);
  return url;
}

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { db } from "@/db/muzero-db";
import type { MediaBlob } from "@/db/types";
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

export interface LocalCoverResource {
  canServe: boolean | null;
  coverBlobId: string | null;
  pending: boolean;
  pendingReason: "row" | "url" | null;
  storageKey: string | null;
  url: string | null;
}

interface LocalCoverState {
  failed: boolean;
  storageKey: string | null;
  url: string | null;
}

/**
 * On Electron with a file-backed cover, the local-media protocol URL an `<img>`
 * loads natively — no blob load, no `URL.createObjectURL`, no bitmap held in the
 * JS heap (the cover-decode churn the switch-jank trace exposed). The `pending`
 * state lets callers avoid starting a blob fallback while the protocol URL is
 * still being resolved. Everywhere else (web/tauri, OPFS/IndexedDB-backed covers,
 * or protocol failure) callers can fall back to the object-URL cover. See the
 * electron-local-media-protocol PRD.
 */
export function useLocalCoverResource(
  track: { coverBlobId?: string } | undefined,
): LocalCoverResource {
  const coverBlobId = track?.coverBlobId;
  const row = useLiveQuery(
    async () => (coverBlobId ? ((await db.mediaBlobs.get(coverBlobId)) ?? null) : null),
    [coverBlobId],
    undefined,
  ) as MediaBlob | null | undefined;
  const rowPending = Boolean(coverBlobId) && row === undefined;
  const servableRow = canServeLocalCover(row)
    ? (row as MediaBlob & { storageBackend: "electron-file"; storageKey: string })
    : null;
  const canServeRow = Boolean(servableRow);
  const storageBackend = servableRow?.storageBackend;
  const storageKey = servableRow?.storageKey;
  const mime = servableRow?.mime;
  const [state, setState] = useState<LocalCoverState>({
    failed: false,
    storageKey: null,
    url: null,
  });

  useEffect(() => {
    if (!storageKey || !canServeLocalCover({ storageBackend, storageKey })) {
      setState({ failed: false, storageKey: null, url: null });
      return;
    }
    const result = ensureLocalCoverUrl(storageKey, mime ?? "image/jpeg");
    if (result == null) {
      setState({ failed: true, storageKey, url: null });
      return;
    }
    if (typeof result === "string") {
      setState({ failed: false, storageKey, url: result });
      return;
    }
    setState((current) =>
      current.storageKey === storageKey && current.url
        ? current
        : { failed: false, storageKey, url: null },
    );
    let alive = true;
    void result
      .then((u) => alive && setState({ failed: false, storageKey, url: u }))
      .catch(() => alive && setState({ failed: true, storageKey, url: null }));
    return () => {
      alive = false;
    };
  }, [storageBackend, storageKey, mime]);

  const url = state.storageKey === storageKey ? state.url : null;
  const failed = state.storageKey === storageKey && state.failed;
  const urlPending = canServeRow && !url && !failed;
  return {
    canServe: rowPending ? null : canServeRow,
    coverBlobId: coverBlobId ?? null,
    pending: rowPending || urlPending,
    pendingReason: rowPending ? "row" : urlPending ? "url" : null,
    storageKey: storageKey ?? null,
    url,
  };
}

export function useLocalCoverUrl(track: { coverBlobId?: string } | undefined): string | null {
  return useLocalCoverResource(track).url;
}

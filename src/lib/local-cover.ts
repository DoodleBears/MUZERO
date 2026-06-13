import type { MediaBlob } from "@/db/types";

/**
 * Whether a cover blob is backed by a real on-disk file the Electron shell can
 * stream natively (via the `muzfetch://local-media` token URL) — i.e. it lives in
 * `persistent-media` with a storage key. When true, the renderer can hand an
 * `<img>` a protocol URL built from the storage key WITHOUT loading the bytes,
 * letting Chromium decode/cache it instead of `blob → object URL → JS-heap bitmap`.
 * OPFS/IndexedDB backends have no servable file → callers fall back to object URLs.
 * See the electron-local-media-protocol PRD.
 */
export function canServeLocalCover(
  blob: { storageBackend?: MediaBlob["storageBackend"]; storageKey?: string } | null | undefined,
): blob is { storageBackend: "electron-file"; storageKey: string } {
  return blob?.storageBackend === "electron-file" && Boolean(blob.storageKey);
}

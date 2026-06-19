import type { MediaBlob } from "@/db/types";
import { type MediaProxyTrace, resolveDesktopBridge } from "@/lib/desktop/bridge";

type StoredMediaBlob = Pick<MediaBlob, "mime" | "storageBackend" | "storageKey">;

export function canUseLocalMediaStorageUrl(row: StoredMediaBlob | null | undefined): boolean {
  if (row?.storageBackend !== "electron-file" || !row.storageKey) return false;
  return typeof resolveDesktopBridge().localMediaUrlForStorageKey === "function";
}

export async function resolveLocalMediaStorageUrl(
  row: StoredMediaBlob | null | undefined,
  trace?: string | MediaProxyTrace,
): Promise<string | null> {
  if (!canUseLocalMediaStorageUrl(row) || !row?.storageKey) return null;
  const build = resolveDesktopBridge().localMediaUrlForStorageKey;
  if (!build) return null;
  return build({ storageKey: row.storageKey, mime: row.mime, trace });
}

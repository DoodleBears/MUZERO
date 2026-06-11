import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import type { AppSettings, PlaybackCacheEntry, Track, TrackKind } from "@/db/types";

const GIB = 1024 ** 3;

export const PLAYBACK_CACHE_MIN_BYTES = GIB;
export const PLAYBACK_CACHE_MAX_BYTES = 10 * GIB;
export const PLAYBACK_CACHE_DEFAULT_BYTES = 2 * GIB;
export const PLAYBACK_CACHE_GB_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export interface PlaybackCacheHit extends PlaybackCacheEntry {
  blob: Blob;
}

export interface PlaybackCacheSummary {
  count: number;
  bytes: number;
}

export function playbackCacheLimitBytes(
  settings: Pick<AppSettings, "id"> & { playbackCacheMaxBytes?: number | null },
): number {
  const raw = Number(settings.playbackCacheMaxBytes ?? PLAYBACK_CACHE_DEFAULT_BYTES);
  if (!Number.isFinite(raw)) return PLAYBACK_CACHE_DEFAULT_BYTES;
  return Math.min(PLAYBACK_CACHE_MAX_BYTES, Math.max(PLAYBACK_CACHE_MIN_BYTES, Math.round(raw)));
}

export async function getCachedRemotePlayback(
  track: Pick<Track, "id" | "kind" | "remoteMediaUrl">,
  db: MuzeroDB = defaultDb,
  now = Date.now,
): Promise<PlaybackCacheHit | null> {
  const sourceUrl = track.remoteMediaUrl;
  if (!sourceUrl) return null;
  const entry = await db.playbackCache.get(cacheId(sourceUrl));
  if (!entry) return null;
  if (
    entry.sourceUrl !== sourceUrl ||
    entry.kind !== track.kind ||
    !mediaMimeMatches(track.kind, entry.mime)
  ) {
    await deletePlaybackCacheEntry(entry, db);
    return null;
  }
  const blob = await readCachedBlob(entry);
  if (!blob) {
    await deletePlaybackCacheEntry(entry, db);
    return null;
  }
  const lastAccessedAt = now();
  await db.playbackCache.update(entry.id, { lastAccessedAt });
  return { ...entry, blob, lastAccessedAt };
}

export async function putRemotePlaybackCache(
  track: Pick<Track, "id" | "kind" | "remoteMediaUrl">,
  media: { blob: Blob; bytes?: number; mime: string },
  options: { maxBytes: number; now?: () => number },
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const sourceUrl = track.remoteMediaUrl;
  if (!sourceUrl || !mediaMimeMatches(track.kind, media.mime)) return;
  const now = options.now ?? Date.now;
  const at = now();
  const bytes = media.bytes ?? media.blob.size;
  if (bytes <= 0 || bytes > options.maxBytes) return;
  const existing = await db.playbackCache.get(cacheId(sourceUrl));
  const stored = await storeCachedBlob(sourceUrl, media.blob, media.mime);
  const entry: PlaybackCacheEntry = {
    id: cacheId(sourceUrl),
    sourceUrl,
    trackId: track.id,
    kind: track.kind,
    storage: stored.storage,
    fileName: stored.fileName,
    mime: media.mime,
    bytes,
    blob: stored.storage === "indexeddb" ? media.blob : undefined,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    lastAccessedAt: at,
  };

  if (existing?.storage === "opfs" && existing.fileName !== entry.fileName) {
    await removeOpfsFile(existing.fileName);
  }
  await db.playbackCache.put(entry);
  await prunePlaybackCache(options.maxBytes, db);
}

export async function summarizePlaybackCache(
  db: MuzeroDB = defaultDb,
): Promise<PlaybackCacheSummary> {
  const rows = await db.playbackCache.toArray();
  return {
    count: rows.length,
    bytes: rows.reduce((total, row) => total + row.bytes, 0),
  };
}

export async function clearPlaybackCache(db: MuzeroDB = defaultDb): Promise<void> {
  const rows = await db.playbackCache.toArray();
  await Promise.all(rows.map((row) => removeCachedBytes(row)));
  await db.playbackCache.clear();
}

export async function prunePlaybackCache(
  maxBytes: number,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  const rows = await db.playbackCache.orderBy("lastAccessedAt").toArray();
  let total = rows.reduce((sum, row) => sum + row.bytes, 0);
  for (const row of rows) {
    if (total <= maxBytes) break;
    await deletePlaybackCacheEntry(row, db);
    total -= row.bytes;
  }
}

function cacheId(sourceUrl: string): string {
  return `remote:${sourceUrl}`;
}

function mediaMimeMatches(kind: TrackKind, mime: string): boolean {
  const normalized = mime.toLowerCase();
  if (kind === "audio") return normalized.startsWith("audio/");
  return normalized.startsWith("video/");
}

async function deletePlaybackCacheEntry(
  entry: PlaybackCacheEntry,
  db: MuzeroDB = defaultDb,
): Promise<void> {
  await removeCachedBytes(entry);
  await db.playbackCache.delete(entry.id);
}

async function removeCachedBytes(entry: PlaybackCacheEntry): Promise<void> {
  if (entry.storage === "opfs") await removeOpfsFile(entry.fileName);
}

async function readCachedBlob(entry: PlaybackCacheEntry): Promise<Blob | null> {
  if (entry.storage === "indexeddb") return entry.blob ?? null;
  if (!entry.fileName) return null;
  try {
    const directory = await playbackCacheDirectory();
    const fileHandle = await directory.getFileHandle(entry.fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

async function storeCachedBlob(
  sourceUrl: string,
  blob: Blob,
  mime: string,
): Promise<{ storage: "opfs" | "indexeddb"; fileName?: string }> {
  try {
    const fileName = await cacheFileName(sourceUrl, mime);
    const directory = await playbackCacheDirectory();
    const fileHandle = await directory.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { storage: "opfs", fileName };
  } catch {
    return { storage: "indexeddb" };
  }
}

async function removeOpfsFile(fileName: string | undefined): Promise<void> {
  if (!fileName) return;
  try {
    const directory = await playbackCacheDirectory();
    await directory.removeEntry(fileName);
  } catch {
    // Missing OPFS files are harmless; the metadata row is still removed.
  }
}

async function playbackCacheDirectory(): Promise<FileSystemDirectoryHandle> {
  const storage = navigator.storage as StorageManager & {
    getDirectory?: () => Promise<FileSystemDirectoryHandle>;
  };
  const root = await storage.getDirectory?.();
  if (!root) throw new Error("OPFS unavailable");
  return root.getDirectoryHandle("muzero-playback-cache", { create: true });
}

async function cacheFileName(sourceUrl: string, mime: string): Promise<string> {
  const hash = await hashText(sourceUrl);
  return `${hash}${extensionForMime(mime)}`;
}

async function hashText(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return Math.abs(hash).toString(16);
}

function extensionForMime(mime: string): string {
  const normalized = mime.toLowerCase().split(";")[0]?.trim();
  if (normalized === "audio/mpeg") return ".mp3";
  if (normalized === "audio/wav" || normalized === "audio/wave") return ".wav";
  if (normalized === "audio/aac") return ".aac";
  if (normalized === "audio/ogg") return ".ogg";
  if (normalized === "video/mp4") return ".mp4";
  if (normalized === "video/webm") return ".webm";
  return ".bin";
}

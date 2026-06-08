import { getAppFetch } from "@/lib/platform";
import {
  type R2Manifest,
  type R2SetIndex,
  r2ManifestSchema,
  r2SetIndexSchema,
} from "./r2-manifest-schema";
import { normalizeManifestUrl, resolveRemoteObjectUrl } from "./r2-url";

export type SyncFetch = typeof globalThis.fetch;

export interface RemoteSetPreview {
  id: string;
  title: string;
  indexUrl: string;
  updatedAt: string;
  trackCount: number;
  bytes: number;
}

export interface RemoteLibraryPreview {
  manifestUrl: string;
  baseUrl: string;
  libraryId: string;
  title: string;
  setCount: number;
  trackCount: number;
  totalBytes: number;
  updatedAt: string;
  manifest: R2Manifest;
  sets: RemoteSetPreview[];
}

export interface ResolvedRemoteTrack {
  id: string;
  title: string;
  mediaUrl: string;
  coverUrl?: string;
  memoryPhotoUrls: Array<{ memoryId: string; url: string }>;
  source: R2SetIndex["tracks"][number];
}

export interface RemoteSetIndexResult {
  indexUrl: string;
  index: R2SetIndex;
  tracks: ResolvedRemoteTrack[];
}

export interface SyncReadOptions {
  fetcher?: SyncFetch;
}

async function resolveFetcher(fetcher?: SyncFetch): Promise<SyncFetch> {
  return fetcher ?? getAppFetch();
}

async function fetchJson(url: string, label: string, fetcher: SyncFetch): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Failed to parse ${label} JSON`, { cause: error });
  }
}

export async function subscribeManifest(
  manifestOrBaseUrl: string,
  options: SyncReadOptions = {},
): Promise<RemoteLibraryPreview> {
  const manifestUrl = normalizeManifestUrl(manifestOrBaseUrl);
  const fetcher = await resolveFetcher(options.fetcher);
  const raw = await fetchJson(manifestUrl, "manifest", fetcher);
  const parsed = r2ManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid manifest: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }

  const manifest = parsed.data;
  const sets = manifest.sets.map((set) => ({
    id: set.id,
    title: set.title,
    indexUrl: resolveRemoteObjectUrl(manifest.baseUrl, set.index),
    updatedAt: set.updatedAt,
    trackCount: set.trackCount,
    bytes: set.bytes,
  }));

  return {
    manifestUrl,
    baseUrl: manifest.baseUrl,
    libraryId: manifest.libraryId,
    title: manifest.title,
    setCount: sets.length,
    trackCount: sets.reduce((total, set) => total + set.trackCount, 0),
    totalBytes: sets.reduce((total, set) => total + set.bytes, 0),
    updatedAt: manifest.updatedAt,
    manifest,
    sets,
  };
}

export async function loadRemoteSetIndex(
  preview: Pick<RemoteLibraryPreview, "baseUrl">,
  set: Pick<RemoteSetPreview, "indexUrl">,
  options: SyncReadOptions = {},
): Promise<RemoteSetIndexResult> {
  const fetcher = await resolveFetcher(options.fetcher);
  const raw = await fetchJson(set.indexUrl, "set index", fetcher);
  const parsed = r2SetIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid set index: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }

  const index = parsed.data;
  return {
    indexUrl: set.indexUrl,
    index,
    tracks: index.tracks.map((track) => ({
      id: track.id,
      title: track.title,
      mediaUrl: resolveRemoteObjectUrl(preview.baseUrl, track.media.url),
      coverUrl: track.cover ? resolveRemoteObjectUrl(preview.baseUrl, track.cover.url) : undefined,
      memoryPhotoUrls: track.memories.flatMap((memory) =>
        memory.photo
          ? [
              {
                memoryId: memory.id,
                url: resolveRemoteObjectUrl(preview.baseUrl, memory.photo.url),
              },
            ]
          : [],
      ),
      source: track,
    })),
  };
}

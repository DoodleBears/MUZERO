import { getAppFetch } from "@/lib/platform";
import {
  type R2EntityCoversIndex,
  type R2Manifest,
  type R2SetIndex,
  type R2ShareManifest,
  r2EntityCoversIndexSchema,
  r2ManifestSchema,
  r2SetIndexSchema,
  r2ShareManifestSchema,
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

export interface RemoteSharePreview {
  shareId: string;
  manifestUrl: string;
}

export interface RemoteShareIndexResult {
  shareId: string;
  manifestUrl: string;
  manifest: R2ShareManifest;
  set: RemoteSetIndexResult;
}

export interface LoadRemoteIndexesForSearchTrackInput {
  preview: Pick<RemoteLibraryPreview, "baseUrl" | "sets">;
  track: {
    setIds: string[];
    shareIds: string[];
  };
  shares?: RemoteSharePreview[];
}

export interface LoadRemoteIndexesForSearchTrackResult {
  sets: RemoteSetIndexResult[];
  shares: RemoteShareIndexResult[];
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

export interface RemoteEntityCoversResult {
  baseUrl: string;
  index: R2EntityCoversIndex;
}

/**
 * Load the library-global entity-covers index a manifest references (or
 * `undefined` when it has none). The result feeds `importRemoteEntityCovers`
 * on the subscriber — the read half of the entity-cover round trip.
 */
export async function loadRemoteEntityCovers(
  preview: Pick<RemoteLibraryPreview, "baseUrl" | "manifest">,
  options: SyncReadOptions = {},
): Promise<RemoteEntityCoversResult | undefined> {
  const path = preview.manifest.entityCoversIndex;
  if (!path) return undefined;
  const fetcher = await resolveFetcher(options.fetcher);
  const url = resolveRemoteObjectUrl(preview.baseUrl, path);
  const raw = await fetchJson(url, "entity covers index", fetcher);
  const parsed = r2EntityCoversIndexSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid entity covers index: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
    );
  }
  return { baseUrl: preview.baseUrl, index: parsed.data };
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

export async function loadRemoteIndexesForSearchTrack(
  input: LoadRemoteIndexesForSearchTrackInput,
  options: SyncReadOptions = {},
): Promise<LoadRemoteIndexesForSearchTrackResult> {
  const fetcher = await resolveFetcher(options.fetcher);
  const targetSetIds = new Set(input.track.setIds);
  const sets: RemoteSetIndexResult[] = [];

  for (const set of input.preview.sets) {
    if (!targetSetIds.has(set.id)) continue;
    sets.push(await loadRemoteSetIndex(input.preview, set, { fetcher }));
  }

  const targetShareIds = new Set(input.track.shareIds);
  const shares: RemoteShareIndexResult[] = [];
  for (const share of input.shares ?? []) {
    if (!targetShareIds.has(share.shareId)) continue;
    const manifest = await loadRemoteShareManifest(share.manifestUrl, fetcher);
    const indexUrl = resolveRemoteObjectUrl(manifest.baseUrl, manifest.index);
    const set = await loadRemoteSetIndex({ baseUrl: manifest.baseUrl }, { indexUrl }, { fetcher });
    shares.push({
      shareId: share.shareId,
      manifestUrl: share.manifestUrl,
      manifest,
      set,
    });
  }

  return { sets, shares };
}

async function loadRemoteShareManifest(
  manifestUrl: string,
  fetcher: SyncFetch,
): Promise<R2ShareManifest> {
  const raw = await fetchJson(manifestUrl, "share manifest", fetcher);
  const parsed = r2ShareManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Invalid share manifest: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
    );
  }
  return parsed.data;
}

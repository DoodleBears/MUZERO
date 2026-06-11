import { newId } from "@/lib/id";
import {
  defaultMediaStorageProvider,
  indexedDbMediaStorageProvider,
  type MediaStorageBackend,
  type MediaStorageProvider,
  mediaStorageKey,
} from "./media-storage-provider";
import { db as defaultDb, type MuzeroDB } from "./muzero-db";
import type { MediaBlob } from "./types";

export type { MediaStorageBackend, MediaStorageProvider };
export { mediaStorageKey };

export interface ResolvedMediaBlob extends Omit<MediaBlob, "blob" | "storageBackend"> {
  storageBackend: MediaStorageBackend;
  blob: Blob;
}

export interface PutMediaBlobInput {
  id?: string;
  trackId: string;
  role: MediaBlob["role"];
  mime: string;
  bytes?: number;
  blob: Blob;
  suggestedName?: string;
}

export interface MediaBlobStorageOptions {
  provider?: MediaStorageProvider;
  providers?: MediaStorageProvider[];
}

export async function putMediaBlob(
  input: PutMediaBlobInput,
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<MediaBlob> {
  const id = input.id ?? newId("blb");
  const bytes = input.bytes ?? input.blob.size;
  const provider = options.provider ?? defaultMediaStorageProvider();

  if (provider.id !== "indexeddb") {
    try {
      const stored = await provider.put({
        id,
        role: input.role,
        mime: input.mime,
        blob: input.blob,
        suggestedName: input.suggestedName,
      });
      if (!stored.storageKey) throw new Error(`${provider.id} did not return a storage key`);
      const row = {
        id,
        trackId: input.trackId,
        role: input.role,
        mime: input.mime,
        bytes,
        storageBackend: provider.id,
        storageKey: stored.storageKey,
        blob: undefined,
      } satisfies MediaBlob;
      try {
        await db.mediaBlobs.put(row);
      } catch (error) {
        await provider.delete({ storageKey: stored.storageKey }).catch(() => {});
        throw error;
      }
      return row;
    } catch {
      // Provider storage is an optimization. Fall back to the legacy durable shape
      // so imports/downloads still complete in runtimes without a file backend.
    }
  }

  const row = {
    id,
    trackId: input.trackId,
    role: input.role,
    mime: input.mime,
    bytes,
    storageBackend: indexedDbMediaStorageProvider.id,
    blob: input.blob,
  } satisfies MediaBlob;
  await db.mediaBlobs.put(row);
  return row;
}

export async function resolveMediaBlob(
  rowOrId: string | MediaBlob | undefined,
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<ResolvedMediaBlob | undefined> {
  const row = typeof rowOrId === "string" ? await db.mediaBlobs.get(rowOrId) : rowOrId;
  if (!row) return undefined;
  const storageBackend = mediaStorageBackend(row);
  const provider = providerFor(storageBackend, options);
  const blob = await provider.get({ storageKey: row.storageKey, blob: row.blob, mime: row.mime });
  if (!blob) return undefined;
  return { ...row, storageBackend, blob };
}

export async function deleteMediaBlob(
  id: string,
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<void> {
  const row = await db.mediaBlobs.get(id);
  if (!row) return;
  await db.mediaBlobs.delete(id);
  await deleteProviderBytes(row, options);
}

export async function deleteMediaBlobsByTrackIds(
  trackIds: string[],
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<void> {
  if (trackIds.length === 0) return;
  const rows = await db.mediaBlobs.where("trackId").anyOf(trackIds).toArray();
  await db.mediaBlobs.where("trackId").anyOf(trackIds).delete();
  await Promise.all(rows.map((row) => deleteProviderBytes(row, options)));
}

export async function copyMediaBlob(
  sourceId: string,
  target: {
    id?: string;
    trackId: string;
    role: MediaBlob["role"];
    mime?: string;
    suggestedName?: string;
  },
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<MediaBlob | undefined> {
  const source = await resolveMediaBlob(sourceId, db, options);
  if (!source) return undefined;
  return putMediaBlob(
    {
      id: target.id,
      trackId: target.trackId,
      role: target.role,
      mime: target.mime ?? source.mime,
      bytes: source.bytes,
      blob: source.blob,
      suggestedName: target.suggestedName,
    },
    db,
    options,
  );
}

function mediaStorageBackend(row: MediaBlob): MediaStorageBackend {
  return row.storageBackend ?? "indexeddb";
}

function providerFor(
  backend: MediaStorageBackend,
  options: MediaBlobStorageOptions,
): MediaStorageProvider {
  if (options.provider?.id === backend) return options.provider;
  const match = options.providers?.find((provider) => provider.id === backend);
  return match ?? defaultMediaStorageProvider(backend);
}

async function deleteProviderBytes(
  row: MediaBlob,
  options: MediaBlobStorageOptions,
): Promise<void> {
  const backend = mediaStorageBackend(row);
  if (backend === "indexeddb") return;
  await providerFor(backend, options)
    .delete({ storageKey: row.storageKey })
    .catch(() => {});
}

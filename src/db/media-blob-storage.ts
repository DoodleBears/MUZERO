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
  migrateLegacyMedia?: boolean;
}

export interface MediaBlobMigrationSummary {
  migrated: number;
  skipped: number;
  failed: number;
}

export interface PersistentMediaMissingEntry {
  id: string;
  role: MediaBlob["role"];
  storageBackend: MediaStorageBackend;
  storageKey?: string;
  bytes: number;
}

export interface PersistentMediaOrphanEntry {
  storageBackend: MediaStorageBackend;
  storageKey: string;
  bytes?: number;
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
  if (options.migrateLegacyMedia && storageBackend === "indexeddb" && row.role === "media") {
    const migrated = await migrateMediaBlobToProvider(row, db, {
      ...options,
      migrateLegacyMedia: false,
    });
    if (migrated && mediaStorageBackend(migrated) !== "indexeddb") {
      return resolveMediaBlob(migrated, db, { ...options, migrateLegacyMedia: false });
    }
  }
  const provider = providerFor(storageBackend, options);
  const blob = await provider.get({ storageKey: row.storageKey, blob: row.blob, mime: row.mime });
  if (!blob) return undefined;
  return { ...row, storageBackend, blob };
}

export async function migrateMediaBlobToProvider(
  rowOrId: string | MediaBlob,
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<MediaBlob | undefined> {
  const row = typeof rowOrId === "string" ? await db.mediaBlobs.get(rowOrId) : rowOrId;
  if (!row) return undefined;
  if (mediaStorageBackend(row) !== "indexeddb") return row;
  if (row.role !== "media") return row;
  const provider = options.provider ?? defaultMediaStorageProvider();
  if (provider.id === "indexeddb") return row;
  const source = await resolveMediaBlob(row, db, {
    ...options,
    provider: indexedDbMediaStorageProvider,
    migrateLegacyMedia: false,
  });
  if (!source) return undefined;
  const migrated = await putMediaBlob(
    {
      id: source.id,
      trackId: source.trackId,
      role: source.role,
      mime: source.mime,
      bytes: source.bytes,
      blob: source.blob,
      suggestedName: source.role,
    },
    db,
    { ...options, provider, migrateLegacyMedia: false },
  );
  return migrated;
}

export async function migrateLegacyMediaBlobs(
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions & {
    limit?: number;
    roles?: ReadonlyArray<MediaBlob["role"]>;
  } = {},
): Promise<MediaBlobMigrationSummary> {
  const roles = new Set(options.roles ?? ["media"]);
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const rows = await db.mediaBlobs.toArray();
  const summary: MediaBlobMigrationSummary = { migrated: 0, skipped: 0, failed: 0 };
  let processed = 0;
  for (const row of rows) {
    if (processed >= limit) break;
    if (mediaStorageBackend(row) !== "indexeddb" || !roles.has(row.role)) {
      summary.skipped += 1;
      continue;
    }
    processed += 1;
    try {
      const migrated = await migrateMediaBlobToProvider(row, db, options);
      if (migrated && mediaStorageBackend(migrated) !== "indexeddb") summary.migrated += 1;
      else summary.skipped += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}

export async function validatePersistentMediaStorage(
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<{
  missing: PersistentMediaMissingEntry[];
  orphaned: PersistentMediaOrphanEntry[];
}> {
  const rows = await db.mediaBlobs.toArray();
  const missing: PersistentMediaMissingEntry[] = [];
  const referenced = new Set<string>();
  for (const row of rows) {
    const backend = mediaStorageBackend(row);
    if (backend === "indexeddb") continue;
    if (row.storageKey) referenced.add(`${backend}:${row.storageKey}`);
    const provider = providerFor(backend, options);
    const blob = await provider.get({ storageKey: row.storageKey, mime: row.mime });
    if (!blob || blob.size !== row.bytes) {
      missing.push({
        id: row.id,
        role: row.role,
        storageBackend: backend,
        storageKey: row.storageKey,
        bytes: row.bytes,
      });
    }
  }

  const orphaned: PersistentMediaOrphanEntry[] = [];
  const providers = uniqueProviders(options);
  for (const provider of providers) {
    if (provider.id === "indexeddb" || !provider.list) continue;
    for (const entry of await provider.list()) {
      if (!referenced.has(`${provider.id}:${entry.storageKey}`)) {
        orphaned.push({
          storageBackend: provider.id,
          storageKey: entry.storageKey,
          bytes: entry.bytes,
        });
      }
    }
  }
  return { missing, orphaned };
}

export async function cleanupOrphanedMediaStorageFiles(
  db: MuzeroDB = defaultDb,
  options: MediaBlobStorageOptions = {},
): Promise<{ deleted: string[]; failed: string[] }> {
  const report = await validatePersistentMediaStorage(db, options);
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const orphan of report.orphaned) {
    const provider = providerFor(orphan.storageBackend, options);
    try {
      await provider.delete({ storageKey: orphan.storageKey });
      deleted.push(orphan.storageKey);
    } catch {
      failed.push(orphan.storageKey);
    }
  }
  return { deleted, failed };
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

function uniqueProviders(options: MediaBlobStorageOptions): MediaStorageProvider[] {
  const providers = [
    options.provider,
    ...(options.providers ?? []),
    defaultMediaStorageProvider("electron-file"),
    defaultMediaStorageProvider("opfs"),
  ].filter(Boolean) as MediaStorageProvider[];
  const byId = new Map<MediaStorageBackend, MediaStorageProvider>();
  for (const provider of providers) {
    if (!byId.has(provider.id)) byId.set(provider.id, provider);
  }
  return [...byId.values()];
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

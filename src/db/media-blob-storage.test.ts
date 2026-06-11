import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOrphanedMediaStorageFiles,
  copyMediaBlob,
  deleteMediaBlob,
  LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES,
  type MediaStorageProvider,
  mediaStorageKey,
  migrateLegacyMediaBlobs,
  migrateMediaBlobToProvider,
  putMediaBlob,
  resolveMediaBlob,
  summarizePersistentMediaStorage,
  validatePersistentMediaStorage,
} from "./media-blob-storage";
import { MuzeroDB } from "./muzero-db";

let db: MuzeroDB;

beforeEach(async () => {
  db = new MuzeroDB(`muzero-media-blob-storage-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(() => {
  db.close();
});

describe("media blob storage resolver", () => {
  it("resolves legacy IndexedDB blob rows", async () => {
    const blob = new Blob(["legacy-bytes"], { type: "audio/mpeg" });
    await db.mediaBlobs.put({
      id: "blb_legacy",
      trackId: "trk_legacy",
      role: "media",
      mime: "audio/mpeg",
      bytes: blob.size,
      blob,
    });

    const resolved = await resolveMediaBlob("blb_legacy", db);

    expect(resolved).toMatchObject({
      id: "blb_legacy",
      trackId: "trk_legacy",
      role: "media",
      storageBackend: "indexeddb",
      bytes: blob.size,
    });
    expect(resolved?.blob).toBeTruthy();
  });

  it("writes provider-backed media rows with a readable storage key", async () => {
    const provider = createMemoryProvider("electron-file");

    const row = await putMediaBlob(
      {
        id: "blb_song",
        trackId: "trk_song",
        role: "media",
        mime: "audio/mpeg",
        blob: new Blob(["song-bytes"], { type: "audio/mpeg" }),
        suggestedName: "../Artist / Song: Demo?.mp3",
      },
      db,
      { provider },
    );

    expect(row).toMatchObject({
      id: "blb_song",
      storageBackend: "electron-file",
      storageKey: "media/Artist - Song Demo__blb_song.mp3",
      bytes: 10,
    });
    expect(row.blob).toBeUndefined();
    await expect(db.mediaBlobs.get("blb_song")).resolves.toMatchObject({
      storageBackend: "electron-file",
      storageKey: "media/Artist - Song Demo__blb_song.mp3",
      blob: undefined,
    });

    const resolved = await resolveMediaBlob("blb_song", db, { providers: [provider] });
    await expect(resolved?.blob.text()).resolves.toBe("song-bytes");
  });

  it("falls back to IndexedDB when the selected provider fails", async () => {
    const provider = createMemoryProvider("opfs");
    provider.put = vi.fn(async () => {
      throw new Error("OPFS unavailable");
    });
    const blob = new Blob(["fallback-bytes"], { type: "audio/mpeg" });

    const row = await putMediaBlob(
      {
        id: "blb_fallback",
        trackId: "trk_fallback",
        role: "media",
        mime: "audio/mpeg",
        blob,
      },
      db,
      { provider },
    );

    expect(row).toMatchObject({
      id: "blb_fallback",
      storageBackend: "indexeddb",
    });
    expect(row.blob).toBeTruthy();
    expect(provider.put).toHaveBeenCalled();
    const resolved = await resolveMediaBlob("blb_fallback", db);
    expect(resolved?.storageBackend).toBe("indexeddb");
    expect(resolved?.blob).toBeTruthy();
  });

  it("deletes provider-backed bytes when deleting metadata", async () => {
    const provider = createMemoryProvider("electron-file");
    await putMediaBlob(
      {
        id: "blb_delete",
        trackId: "trk_delete",
        role: "media",
        mime: "video/mp4",
        blob: new Blob(["video"], { type: "video/mp4" }),
        suggestedName: "Clip.mp4",
      },
      db,
      { provider },
    );
    expect(provider.has("media/Clip__blb_delete.mp4")).toBe(true);

    await deleteMediaBlob("blb_delete", db, { providers: [provider] });

    await expect(db.mediaBlobs.get("blb_delete")).resolves.toBeUndefined();
    expect(provider.has("media/Clip__blb_delete.mp4")).toBe(false);
  });

  it("copies a resolved media blob through the selected provider", async () => {
    const provider = createMemoryProvider("electron-file");
    await putMediaBlob(
      {
        id: "blb_source",
        trackId: "trk_source",
        role: "memory",
        mime: "image/jpeg",
        blob: new Blob(["photo"], { type: "image/jpeg" }),
        suggestedName: "Memory Photo.jpg",
      },
      db,
      { provider },
    );

    const copy = await copyMediaBlob(
      "blb_source",
      {
        id: "blb_cover",
        trackId: "trk_source",
        role: "cover",
        suggestedName: "Memory Cover.jpg",
      },
      db,
      { provider },
    );

    expect(copy).toMatchObject({
      id: "blb_cover",
      role: "cover",
      storageBackend: "electron-file",
      storageKey: "cover/Memory Cover__blb_cover.jpg",
      bytes: 5,
    });
    const resolved = await resolveMediaBlob(copy, db, { providers: [provider] });
    await expect(resolved?.blob.text()).resolves.toBe("photo");
  });

  it("builds readable collision-safe storage keys", () => {
    expect(
      mediaStorageKey({
        id: "blb_abc",
        role: "cover",
        mime: "image/jpeg",
        suggestedName: "  ../Album: Cover / 2026.JPG  ",
      }),
    ).toBe("cover/Album Cover - 2026__blb_abc.jpg");
  });

  it("migrates legacy media rows to the selected provider", async () => {
    const provider = createMemoryProvider("opfs");
    await db.mediaBlobs.put({
      id: "blb_legacy_media",
      trackId: "trk_legacy",
      role: "media",
      mime: "audio/mpeg",
      bytes: 12,
      blob: new Blob(["legacy-media"], { type: "audio/mpeg" }),
    });

    const migrated = await migrateMediaBlobToProvider("blb_legacy_media", db, { provider });

    expect(migrated).toMatchObject({
      id: "blb_legacy_media",
      storageBackend: "opfs",
      storageKey: "media/media__blb_legacy_media.mp3",
      blob: undefined,
    });
    const row = await db.mediaBlobs.get("blb_legacy_media");
    expect(row?.blob).toBeUndefined();
    expect(provider.has("media/media__blb_legacy_media.mp3")).toBe(true);
  });

  it("can lazily migrate legacy media during resolve when requested", async () => {
    const provider = createMemoryProvider("electron-file");
    await db.mediaBlobs.put({
      id: "blb_lazy_media",
      trackId: "trk_lazy",
      role: "media",
      mime: "audio/mpeg",
      bytes: 10,
      blob: new Blob(["lazy-media"], { type: "audio/mpeg" }),
    });

    const resolved = await resolveMediaBlob("blb_lazy_media", db, {
      provider,
      migrateLegacyMedia: true,
    });

    expect(resolved).toMatchObject({
      id: "blb_lazy_media",
      storageBackend: "electron-file",
      storageKey: "media/media__blb_lazy_media.mp3",
    });
    expect((await db.mediaBlobs.get("blb_lazy_media"))?.blob).toBeUndefined();
  });

  it("migrates legacy media rows in batches and skips non-media rows by default", async () => {
    const provider = createMemoryProvider("opfs");
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_media_a",
        trackId: "trk_a",
        role: "media",
        mime: "audio/mpeg",
        bytes: 1,
        blob: new Blob(["a"], { type: "audio/mpeg" }),
      },
      {
        id: "blb_cover_a",
        trackId: "trk_a",
        role: "cover",
        mime: "image/png",
        bytes: 1,
        blob: new Blob(["c"], { type: "image/png" }),
      },
    ]);

    const result = await migrateLegacyMediaBlobs(db, { provider, limit: 10 });

    expect(result).toEqual({ migrated: 1, skipped: 1, failed: 0 });
    expect((await db.mediaBlobs.get("blb_media_a"))?.storageBackend).toBe("opfs");
    expect((await db.mediaBlobs.get("blb_cover_a"))?.storageBackend).toBeUndefined();
  });

  it("migrates selected legacy image roles for large background and gallery assets", async () => {
    const provider = createMemoryProvider("opfs");
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_background_a",
        trackId: "trk_a",
        role: "background",
        mime: "image/png",
        bytes: 10,
        blob: new Blob(["background"], { type: "image/png" }),
      },
      {
        id: "blb_gallery_a",
        trackId: "global",
        role: "gallery",
        mime: "image/webp",
        bytes: 7,
        blob: new Blob(["gallery"], { type: "image/webp" }),
      },
      {
        id: "blb_cover_a",
        trackId: "trk_a",
        role: "cover",
        mime: "image/png",
        bytes: 5,
        blob: new Blob(["cover"], { type: "image/png" }),
      },
    ]);

    const result = await migrateLegacyMediaBlobs(db, {
      provider,
      roles: ["background", "gallery"],
    });

    expect(result).toEqual({ migrated: 2, skipped: 1, failed: 0 });
    expect((await db.mediaBlobs.get("blb_background_a"))?.storageBackend).toBe("opfs");
    expect((await db.mediaBlobs.get("blb_gallery_a"))?.storageBackend).toBe("opfs");
    expect((await db.mediaBlobs.get("blb_cover_a"))?.storageBackend).toBeUndefined();
    expect(provider.has("background/background__blb_background_a.png")).toBe(true);
    expect(provider.has("gallery/gallery__blb_gallery_a.webp")).toBe(true);
  });

  it("migrates only large legacy cover memory and avatar images above the threshold", async () => {
    const provider = createMemoryProvider("opfs");
    await db.mediaBlobs.bulkPut([
      {
        id: "blb_cover_large",
        trackId: "trk_a",
        role: "cover",
        mime: "image/jpeg",
        bytes: LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES,
        blob: new Blob([new Uint8Array(LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES)], {
          type: "image/jpeg",
        }),
      },
      {
        id: "blb_memory_large",
        trackId: "trk_a",
        role: "memory",
        mime: "image/png",
        bytes: LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES + 1,
        blob: new Blob([new Uint8Array(LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES + 1)], {
          type: "image/png",
        }),
      },
      {
        id: "blb_avatar_small",
        trackId: "dev_local",
        role: "avatar",
        mime: "image/png",
        bytes: LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES - 1,
        blob: new Blob([new Uint8Array(LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES - 1)], {
          type: "image/png",
        }),
      },
      {
        id: "blb_gallery_large",
        trackId: "global",
        role: "gallery",
        mime: "image/webp",
        bytes: LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES,
        blob: new Blob([new Uint8Array(LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES)], {
          type: "image/webp",
        }),
      },
    ]);

    const result = await migrateLegacyMediaBlobs(db, {
      provider,
      roles: ["cover", "memory", "avatar"],
      minBytes: LARGE_IMAGE_PROVIDER_THRESHOLD_BYTES,
    });

    expect(result).toEqual({ migrated: 2, skipped: 2, failed: 0 });
    expect((await db.mediaBlobs.get("blb_cover_large"))?.storageBackend).toBe("opfs");
    expect((await db.mediaBlobs.get("blb_memory_large"))?.storageBackend).toBe("opfs");
    expect((await db.mediaBlobs.get("blb_avatar_small"))?.storageBackend).toBeUndefined();
    expect((await db.mediaBlobs.get("blb_gallery_large"))?.storageBackend).toBeUndefined();
  });

  it("reports missing provider-backed files and deletes orphan provider files", async () => {
    const provider = createMemoryProvider("electron-file");
    await putMediaBlob(
      {
        id: "blb_referenced",
        trackId: "trk_ref",
        role: "media",
        mime: "audio/mpeg",
        blob: new Blob(["referenced"], { type: "audio/mpeg" }),
      },
      db,
      { provider },
    );
    await db.mediaBlobs.put({
      id: "blb_missing",
      trackId: "trk_missing",
      role: "media",
      mime: "audio/mpeg",
      bytes: 7,
      storageBackend: "electron-file",
      storageKey: "media/missing__blb_missing.mp3",
    });
    provider.seed("media/orphan__blb_orphan.mp3", new Blob(["orphan"], { type: "audio/mpeg" }));

    const report = await validatePersistentMediaStorage(db, { provider });
    expect(report.missing.map((entry) => entry.id)).toEqual(["blb_missing"]);
    expect(report.orphaned.map((entry) => entry.storageKey)).toEqual([
      "media/orphan__blb_orphan.mp3",
    ]);

    const cleanup = await cleanupOrphanedMediaStorageFiles(db, { provider });
    expect(cleanup.deleted).toEqual(["media/orphan__blb_orphan.mp3"]);
    expect(provider.has("media/orphan__blb_orphan.mp3")).toBe(false);
    expect(provider.has((await db.mediaBlobs.get("blb_referenced"))?.storageKey ?? "")).toBe(true);
  });

  it("summarizes permanent media storage by backend and role", async () => {
    const provider = createMemoryProvider("opfs");
    await putMediaBlob(
      {
        id: "blb_provider_media",
        trackId: "trk_provider",
        role: "media",
        mime: "audio/mpeg",
        blob: new Blob(["provider"], { type: "audio/mpeg" }),
      },
      db,
      { provider },
    );
    await db.mediaBlobs.put({
      id: "blb_legacy_media",
      trackId: "trk_legacy",
      role: "media",
      mime: "audio/mpeg",
      bytes: 6,
      blob: new Blob(["legacy"], { type: "audio/mpeg" }),
    });
    await db.mediaBlobs.put({
      id: "blb_cover",
      trackId: "trk_cover",
      role: "cover",
      mime: "image/png",
      bytes: 5,
      blob: new Blob(["cover"], { type: "image/png" }),
    });

    const summary = await summarizePersistentMediaStorage(db, {
      provider,
      includeHealth: true,
    });

    expect(summary.count).toBe(3);
    expect(summary.bytes).toBe(19);
    expect(summary.legacyMediaCount).toBe(1);
    expect(summary.byBackend.opfs).toMatchObject({ count: 1, bytes: 8 });
    expect(summary.byBackend.indexeddb).toMatchObject({ count: 2, bytes: 11 });
    expect(summary.byRole.media).toMatchObject({ count: 2, bytes: 14 });
    expect(summary.byRole.cover).toMatchObject({ count: 1, bytes: 5 });
    expect(summary.missingCount).toBe(0);
    expect(summary.orphanedCount).toBe(0);
  });
});

function createMemoryProvider(id: "electron-file" | "opfs"): MediaStorageProvider & {
  has: (key: string) => boolean;
  seed: (key: string, blob: Blob) => void;
} {
  const files = new Map<string, Blob>();
  return {
    id,
    userVisible: id === "electron-file",
    async put(input) {
      const storageKey = mediaStorageKey(input);
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
    async list() {
      return [...files.entries()].map(([storageKey, blob]) => ({ storageKey, bytes: blob.size }));
    },
    has(key) {
      return files.has(key);
    },
    seed(key, blob) {
      files.set(key, blob);
    },
  };
}

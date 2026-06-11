import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyMediaBlob,
  deleteMediaBlob,
  type MediaStorageProvider,
  mediaStorageKey,
  putMediaBlob,
  resolveMediaBlob,
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
});

function createMemoryProvider(
  id: "electron-file" | "opfs",
): MediaStorageProvider & { has: (key: string) => boolean } {
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
    has(key) {
      return files.has(key);
    },
  };
}

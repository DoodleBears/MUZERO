import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MediaStorageProvider, putMediaBlob } from "./media-blob-storage";
import { MuzeroDB } from "./muzero-db";
import {
  addMemory,
  createSession,
  createUploadedTrack,
  getTrack,
  listMemories,
  setTrackCoverFromMemory,
} from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-memory-cover-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function createMemoryProvider(id: "opfs" | "electron-file" = "opfs") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider = {
    id,
    userVisible: id === "electron-file",
    async put(input) {
      const storageKey = `memory/${input.id}`;
      files.set(storageKey, input.blob);
      return { storageKey };
    },
    async get(input) {
      return input.storageKey ? (files.get(input.storageKey) ?? null) : null;
    },
    async delete(input) {
      if (input.storageKey) files.delete(input.storageKey);
    },
  };
  return provider;
}

describe("setTrackCoverFromMemory", () => {
  it("copies a memory photo into a track cover without deleting the memory photo", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        blob: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
        durationSec: 12,
        kind: "audio",
        mime: "audio/wav",
        sessionId: session.id,
        title: "Rain Loop",
      },
      db,
    );
    const memory = await addMemory(
      {
        note: "train window",
        photo: { blob: new Blob([new Uint8Array([7])], { type: "image/png" }), mime: "image/png" },
        trackId: track.id,
      },
      db,
    );

    await expect(setTrackCoverFromMemory(memory.id, db)).resolves.toBe(true);

    const updated = await getTrack(track.id, db);
    expect(updated?.coverBlobId).toBeTruthy();
    expect(updated?.coverBlobId).not.toBe(memory.photoBlobId);
    expect(updated?.coverCrop).toBeUndefined();
    const cover = await db.mediaBlobs.get(updated?.coverBlobId ?? "");
    expect(cover).toMatchObject({
      mime: "image/png",
      role: "cover",
      trackId: track.id,
    });
    const [reloadedMemory] = await listMemories(track.id, db);
    expect(await db.mediaBlobs.get(reloadedMemory.photoBlobId ?? "")).toBeTruthy();
  });

  it("does not update the track when the memory has no photo", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        blob: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
        durationSec: 12,
        kind: "audio",
        mime: "audio/wav",
        sessionId: session.id,
        title: "Plain Loop",
      },
      db,
    );
    const memory = await addMemory({ note: "just words", trackId: track.id }, db);

    await expect(setTrackCoverFromMemory(memory.id, db)).resolves.toBe(false);
    expect((await getTrack(track.id, db))?.coverBlobId).toBeUndefined();
  });

  it("copies provider-backed memory photos into a track cover", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        blob: new Blob([new Uint8Array([1])], { type: "audio/wav" }),
        durationSec: 12,
        kind: "audio",
        mime: "audio/wav",
        sessionId: session.id,
        title: "Provider Memory Loop",
      },
      db,
    );
    const memory = await addMemory({ note: "provider photo", trackId: track.id }, db);
    const provider = createMemoryProvider("opfs");
    const photo = await putMediaBlob(
      {
        id: "blb_provider_memory_photo",
        trackId: track.id,
        role: "memory",
        mime: "image/png",
        blob: new Blob(["provider-photo"], { type: "image/png" }),
      },
      db,
      { provider },
    );
    await db.memories.update(memory.id, { photoBlobId: photo.id });

    await expect(setTrackCoverFromMemory(memory.id, db, { providers: [provider] })).resolves.toBe(
      true,
    );

    const updated = await getTrack(track.id, db);
    const cover = await db.mediaBlobs.get(updated?.coverBlobId ?? "");
    expect(cover).toMatchObject({
      bytes: "provider-photo".length,
      mime: "image/png",
      role: "cover",
      trackId: track.id,
    });
  });
});

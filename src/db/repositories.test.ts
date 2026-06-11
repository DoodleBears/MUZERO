import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type MediaStorageProvider, putMediaBlob } from "./media-blob-storage";
import { MuzeroDB } from "./muzero-db";
import {
  addGalleryImage,
  addMemory,
  addTrackBackground,
  clearSessionCover,
  clearTrackCover,
  createPendingTrack,
  createSession,
  createUploadedTrack,
  deleteImageBlob,
  deleteMemory,
  deleteSession,
  deleteTrack,
  deleteTracks,
  findSessionByStreamPlaylist,
  getAllTags,
  getEntityCover,
  getMemoryPhoto,
  getPlayQueue,
  getSession,
  getSessionCover,
  getSettings,
  getTrack,
  knownSourcePaths,
  listAllTracks,
  listGalleryImages,
  listMemories,
  listTrackBackgrounds,
  markTrackReady,
  memoryNotesByTrack,
  playQueueSet,
  prependTrackIds,
  removeImportFolder,
  removeTracksFromSession,
  resetAllShortcuts,
  resetShortcut,
  saveSettings,
  setSessionCover,
  setShortcutOverride,
  setTrackCover,
  setTrackNote,
  setTrackTags,
  updateMemory,
  updateMemoryNote,
  upsertImportFolder,
} from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-test-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

function createMemoryProvider(id: "opfs" | "electron-file" = "electron-file") {
  const files = new Map<string, Blob>();
  const provider: MediaStorageProvider & { files: Map<string, Blob> } = {
    id,
    userVisible: id === "electron-file",
    files,
    async put(input) {
      const storageKey = `media/${input.suggestedName ?? input.id}`;
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

describe("settings", () => {
  it("defaults and persists player repeat/shuffle toggles", async () => {
    expect(await getSettings(db)).toMatchObject({
      playerRepeatMode: "off",
      playerShuffle: false,
    });

    await saveSettings({ playerRepeatMode: "one", playerShuffle: true }, db);

    expect(await getSettings(db)).toMatchObject({
      playerRepeatMode: "one",
      playerShuffle: true,
    });
  });

  it("sets, resets, and clears keyboard-shortcut overrides", async () => {
    const z = { kind: "key" as const, stroke: { code: "KeyZ", keyLabel: "Z" } };
    await setShortcutOverride("playback.prev", [z], db);
    await setShortcutOverride("playback.next", [], db); // explicitly unbound
    expect((await getSettings(db)).shortcutOverrides).toEqual({
      "playback.prev": [z],
      "playback.next": [],
    });

    await resetShortcut("playback.prev", db);
    expect((await getSettings(db)).shortcutOverrides).toEqual({ "playback.next": [] });

    await resetAllShortcuts(db);
    expect((await getSettings(db)).shortcutOverrides).toEqual({});
  });
});

describe("prependTrackIds", () => {
  it("adds new tracks to the FRONT (newest on top)", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await prependTrackIds(s.id, ["a", "b"], db);
    await prependTrackIds(s.id, ["c"], db);
    const got = await getSession(s.id, db);
    expect(got?.trackIds).toEqual(["c", "a", "b"]);
  });
});

describe("findSessionByStreamPlaylist", () => {
  it("records a streamPlaylistRef and finds the set again by (source, id)", async () => {
    const s = await createSession(
      {
        seedPrompt: "",
        config: { autoExtend: false },
        streamPlaylistRef: { source: "netease", id: "777" },
      },
      db,
    );
    expect(s.streamPlaylistRef).toEqual({ source: "netease", id: "777" });
    const found = await findSessionByStreamPlaylist("netease", "777", db);
    expect(found?.id).toBe(s.id);
  });

  it("returns undefined for an unsynced playlist or a different source", async () => {
    await createSession(
      {
        seedPrompt: "",
        config: { autoExtend: false },
        streamPlaylistRef: { source: "netease", id: "777" },
      },
      db,
    );
    expect(await findSessionByStreamPlaylist("netease", "888", db)).toBeUndefined();
    expect(await findSessionByStreamPlaylist("bili", "777", db)).toBeUndefined();
  });
});

describe("setSessionCover / getSessionCover", () => {
  it("stores a set-level cover and reads it back", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" });
    await setSessionCover({ sessionId: s.id, blob, mime: "image/png" }, db);
    const got = await getSession(s.id, db);
    expect(got?.coverBlobId).toBeTruthy();
    // The cover row is created correctly (role/key/mime — string fields survive
    // fake-indexeddb; it doesn't preserve Blob bytes, but real IndexedDB does).
    const row = await db.mediaBlobs.get(got?.coverBlobId ?? "");
    expect(row?.role).toBe("cover");
    expect(row?.trackId).toBe(s.id);
    expect(row?.mime).toBe("image/png");
    // getSessionCover resolves the stored blob via coverBlobId.
    expect(await getSessionCover(s.id, db)).toBeTruthy();
  });

  it("resolves provider-backed set covers", async () => {
    const provider = createMemoryProvider("opfs");
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const cover = await putMediaBlob(
      {
        id: "blb_session_provider_cover",
        trackId: s.id,
        role: "cover",
        mime: "image/jpeg",
        blob: new Blob(["set-cover"], { type: "image/jpeg" }),
      },
      db,
      { provider },
    );
    await db.sessions.update(s.id, { coverBlobId: cover.id });

    await expect(
      (await getSessionCover(s.id, db, { providers: [provider] }))?.text(),
    ).resolves.toBe("set-cover");
  });

  it("stores a non-destructive square crop on the session", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([1])], { type: "image/png" });
    await setSessionCover(
      { sessionId: s.id, blob, mime: "image/png", crop: { x: 1, y: 2, width: 3, height: 4 } },
      db,
    );
    expect((await getSession(s.id, db))?.coverCrop).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });

  it("clearSessionCover removes the pinned cover (row + blob), reverting to the default", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await setSessionCover(
      {
        sessionId: s.id,
        blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
        mime: "image/png",
        crop: { x: 1, y: 2, width: 3, height: 4 },
      },
      db,
    );
    const blobId = (await getSession(s.id, db))?.coverBlobId ?? "";

    await clearSessionCover(s.id, db);

    const got = await getSession(s.id, db);
    expect(got?.coverBlobId).toBeUndefined();
    expect(got?.coverCrop).toBeUndefined();
    expect(await db.mediaBlobs.get(blobId)).toBeUndefined();
    expect(await getSessionCover(s.id, db)).toBeUndefined();
  });
});

describe("getEntityCover", () => {
  it("resolves provider-backed custom entity covers", async () => {
    const provider = createMemoryProvider("opfs");
    const cover = await putMediaBlob(
      {
        id: "blb_entity_provider_cover",
        trackId: "artist:deidian",
        role: "cover",
        mime: "image/png",
        blob: new Blob(["entity-cover"], { type: "image/png" }),
      },
      db,
      { provider },
    );
    await db.entityCovers.put({
      id: "artist:deidian",
      kind: "artist",
      coverBlobId: cover.id,
      updatedAt: 1,
    });

    await expect(
      (await getEntityCover("artist:deidian", db, { providers: [provider] }))?.text(),
    ).resolves.toBe("entity-cover");
  });
});

describe("clearTrackCover", () => {
  it("removes a track's cover (row + blob) and its crop/thumbhash", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Moonstone Beach",
        kind: "audio",
        blob: new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 180,
      },
      db,
    );
    await setTrackCover(
      {
        trackId: track.id,
        blob: new Blob([new Uint8Array([9])], { type: "image/png" }),
        mime: "image/png",
        crop: { x: 1, y: 2, width: 3, height: 4 },
      },
      db,
    );
    const blobId = (await getTrack(track.id, db))?.coverBlobId ?? "";
    expect(blobId).toBeTruthy();

    await clearTrackCover(track.id, db);

    const got = await getTrack(track.id, db);
    expect(got?.coverBlobId).toBeUndefined();
    expect(got?.coverCrop).toBeUndefined();
    expect(got?.coverThumbhash).toBeUndefined();
    expect(await db.mediaBlobs.get(blobId)).toBeUndefined();
  });

  it("is a no-op when the track has no cover", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "No Cover",
        kind: "audio",
        blob: new Blob([new Uint8Array([1])], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 5,
      },
      db,
    );
    await expect(clearTrackCover(track.id, db)).resolves.toBeUndefined();
    expect((await getTrack(track.id, db))?.coverBlobId).toBeUndefined();
  });
});

describe("createUploadedTrack", () => {
  it("creates a ready video track with a media blob and no brief", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/mp4" });
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Home Video",
        kind: "video",
        blob,
        mime: "video/mp4",
        durationSec: 12,
      },
      db,
    );
    expect(track.status).toBe("ready");
    expect(track.origin).toBe("uploaded");
    expect(track.kind).toBe("video");
    expect(track.brief).toBeUndefined();
    expect(track.blobId).toBeTruthy();
    expect(track.tags).toEqual([]);
    const media = await db.mediaBlobs.get(track.blobId!);
    expect(media?.role).toBe("media");
    expect(media?.bytes).toBe(4);
  });

  it("stores imported media metadata and embedded cover art out of the track row", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const cover = new Blob([new Uint8Array([9, 8, 7])], { type: "image/jpeg" });
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Moonstone Beach",
        kind: "audio",
        blob,
        mime: "audio/mpeg",
        durationSec: 180,
        mediaMetadata: {
          album: "Soluna",
          artists: ["Deidian"],
          originalFileName: "04 Moonstone Beach.mp3",
          originalMime: "audio/mpeg",
          parser: "music-metadata",
          parsedAt: 1,
          title: "Moonstone Beach",
          year: 2026,
        },
        embeddedCover: { blob: cover, mime: "image/jpeg" },
      },
      db,
    );

    expect(track.mediaMetadata).toMatchObject({
      album: "Soluna",
      artists: ["Deidian"],
      originalFileName: "04 Moonstone Beach.mp3",
    });
    expect(track.coverBlobId).toBeTruthy();
    const coverRow = await db.mediaBlobs.get(track.coverBlobId!);
    expect(coverRow).toMatchObject({
      bytes: 3,
      mime: "image/jpeg",
      role: "cover",
      trackId: track.id,
    });
  });

  it("writes primary media through the selected storage provider while keeping covers in IndexedDB", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const provider = createMemoryProvider("electron-file");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mpeg" });
    const cover = new Blob([new Uint8Array([9, 8, 7])], { type: "image/jpeg" });

    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Provider Song",
        kind: "audio",
        blob,
        mime: "audio/mpeg",
        durationSec: 180,
        mediaMetadata: { originalFileName: "Provider Song.mp3" },
        embeddedCover: { blob: cover, mime: "image/jpeg" },
      },
      db,
      { provider },
    );

    const media = await db.mediaBlobs.get(track.blobId!);
    expect(media).toMatchObject({
      role: "media",
      storageBackend: "electron-file",
      storageKey: "media/Provider Song.mp3",
      blob: undefined,
    });
    expect(provider.files.get(media?.storageKey ?? "")).toBe(blob);

    const coverRow = await db.mediaBlobs.get(track.coverBlobId!);
    expect(coverRow).toMatchObject({
      role: "cover",
      storageBackend: "indexeddb",
      bytes: 3,
    });
    expect(coverRow?.blob).toBeTruthy();
  });
});

describe("createPendingTrack provenance", () => {
  it("stores provider preset provenance and creates a first memory note", async () => {
    const session = await createSession({ seedPrompt: "late rain" }, db);

    const track = await createPendingTrack(
      {
        sessionId: session.id,
        provider: "cloud",
        providerPreset: "mureka:mureka-6",
        provenanceMemoryNote: "DJ generated for late rain · mureka:mureka-6 · soft handoff",
        brief: {
          title: "Rain Relay",
          caption: "rainy garage",
          lyrics: "",
          durationSec: 60,
          djNote: "soft handoff",
        },
      },
      db,
    );

    expect(track.providerPreset).toBe("mureka:mureka-6");
    const reloaded = await getTrack(track.id, db);
    expect(reloaded?.providerPreset).toBe("mureka:mureka-6");
    expect(await memoryNotesByTrack([track.id], db)).toEqual(
      new Map([[track.id, ["DJ generated for late rain · mureka:mureka-6 · soft handoff"]]]),
    );
  });
});

describe("markTrackReady", () => {
  it("marks generated tracks ready only after media is stored durably", async () => {
    const session = await createSession({ seedPrompt: "late rain" }, db);
    const track = await createPendingTrack(
      {
        sessionId: session.id,
        provider: "mock",
        brief: {
          title: "Ready Soon",
          caption: "rainy garage",
          lyrics: "",
          durationSec: 60,
        },
      },
      db,
    );
    const provider = createMemoryProvider("opfs");

    await markTrackReady(
      {
        trackId: track.id,
        blob: new Blob(["generated"], { type: "audio/wav" }),
        mime: "audio/wav",
        durationSec: 61,
      },
      db,
      { provider },
    );

    const reloaded = await getTrack(track.id, db);
    expect(reloaded).toMatchObject({ status: "ready", durationSec: 61 });
    const media = await db.mediaBlobs.get(reloaded?.blobId ?? "");
    expect(media).toMatchObject({
      role: "media",
      storageBackend: "opfs",
      blob: undefined,
    });
    expect(provider.files.get(media?.storageKey ?? "")).toBeTruthy();
  });
});

describe("annotations", () => {
  it("normalizes tags (trim, lowercase, de-dupe) and stores a note", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([0])], { type: "audio/mpeg" });
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Memo",
        kind: "audio",
        blob,
        mime: "audio/mpeg",
        durationSec: 5,
      },
      db,
    );

    await setTrackTags(track.id, ["  RoadTrip ", "roadtrip", "Nostalgia", ""], db);
    await setTrackNote(track.id, "  summer 2019  ", db);

    const reloaded = await getTrack(track.id, db);
    expect(reloaded?.tags).toEqual(["roadtrip", "nostalgia"]);
    expect(reloaded?.note).toBe("summer 2019");
  });

  it("aggregates tag counts across tracks", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const mk = async (title: string, tags: string[]) => {
      const t = await createUploadedTrack(
        {
          sessionId: session.id,
          title,
          kind: "audio",
          blob: new Blob([new Uint8Array([0])], { type: "audio/mpeg" }),
          mime: "audio/mpeg",
          durationSec: 1,
        },
        db,
      );
      await setTrackTags(t.id, tags, db);
    };
    await mk("a", ["chill", "focus"]);
    await mk("b", ["chill"]);

    const tags = await getAllTags(db);
    expect(tags[0]).toEqual({ tag: "chill", count: 2 });
    expect(tags.find((t) => t.tag === "focus")?.count).toBe(1);
    expect(await listAllTracks(db)).toHaveLength(2);
  });
});

describe("track backgrounds", () => {
  it("lists per-track slideshow images and deletes only the selected one", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const makeTrack = (title: string) =>
      createUploadedTrack(
        {
          sessionId: session.id,
          title,
          kind: "audio",
          blob: new Blob([new Uint8Array([0])], { type: "audio/mpeg" }),
          mime: "audio/mpeg",
          durationSec: 1,
        },
        db,
      );
    const first = await makeTrack("first");
    const second = await makeTrack("second");

    const a = await addTrackBackground(
      {
        trackId: first.id,
        blob: new Blob([new Uint8Array([1])], { type: "image/png" }),
        mime: "image/png",
      },
      db,
    );
    const b = await addTrackBackground(
      {
        trackId: first.id,
        blob: new Blob([new Uint8Array([2])], { type: "image/jpeg" }),
        mime: "image/jpeg",
      },
      db,
    );
    await addTrackBackground(
      {
        trackId: second.id,
        blob: new Blob([new Uint8Array([3])], { type: "image/webp" }),
        mime: "image/webp",
      },
      db,
    );

    expect((await listTrackBackgrounds(first.id, db)).map((bg) => bg.id).sort()).toEqual(
      [a.id, b.id].sort(),
    );

    await deleteImageBlob(a.id, db);

    expect((await listTrackBackgrounds(first.id, db)).map((bg) => bg.id)).toEqual([b.id]);
    expect(await listTrackBackgrounds(second.id, db)).toHaveLength(1);
  });

  it("stores large background and gallery images through provider storage", async () => {
    const provider = createMemoryProvider("opfs");
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "big image host",
        kind: "audio",
        blob: new Blob(["audio"], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 1,
      },
      db,
    );

    const background = await addTrackBackground(
      {
        trackId: track.id,
        blob: new Blob(["background"], { type: "image/png" }),
        mime: "image/png",
      },
      db,
      { provider },
    );
    const gallery = await addGalleryImage(
      {
        blob: new Blob(["gallery"], { type: "image/webp" }),
        mime: "image/webp",
      },
      db,
      { provider },
    );

    expect(background.storageBackend).toBe("opfs");
    expect(background.storageKey).toBeTruthy();
    expect(background.blob).toBeUndefined();
    expect(gallery.storageBackend).toBe("opfs");
    expect(gallery.storageKey).toBeTruthy();
    expect(gallery.blob).toBeUndefined();
    expect(provider.files.has(background.storageKey ?? "")).toBe(true);
    expect(provider.files.has(gallery.storageKey ?? "")).toBe(true);

    const listedBackgrounds = await listTrackBackgrounds(track.id, db, { providers: [provider] });
    const listedGallery = await listGalleryImages(db, { providers: [provider] });

    expect(await listedBackgrounds[0]?.blob?.text()).toBe("background");
    expect(await listedGallery[0]?.blob?.text()).toBe("gallery");

    await deleteImageBlob(background.id, db, { providers: [provider] });

    expect(provider.files.has(background.storageKey ?? "")).toBe(false);
    expect(await listTrackBackgrounds(track.id, db, { providers: [provider] })).toEqual([]);
    expect((await listGalleryImages(db, { providers: [provider] })).map((img) => img.id)).toEqual([
      gallery.id,
    ]);
  });
});

describe("memories (one-to-many)", () => {
  it("adds multiple memories to a track, listed oldest → newest", async () => {
    const a = await addMemory({ trackId: "trk_1", note: "first listen", createdAt: 1 }, db);
    const b = await addMemory({ trackId: "trk_1", note: "  on the train  ", createdAt: 2 }, db);
    await addMemory({ trackId: "trk_2", note: "someone else's song", createdAt: 1 }, db);

    const list = await listMemories("trk_1", db);
    expect(list.map((m) => m.id)).toEqual([a.id, b.id]); // createdAt order
    expect(list.map((m) => m.note)).toEqual(["first listen", "on the train"]); // trimmed
    expect(await listMemories("trk_2", db)).toHaveLength(1);
  });

  it("stores a photo in mediaBlobs with role 'memory' and resolves it", async () => {
    const photo = new Blob([new Uint8Array([7, 7, 7])], { type: "image/jpeg" });
    const mem = await addMemory(
      { trackId: "trk_p", note: "beach", photo: { blob: photo, mime: "image/jpeg" } },
      db,
    );
    expect(mem.photoBlobId).toBeTruthy();
    const row = await db.mediaBlobs.get(mem.photoBlobId ?? "");
    expect(row?.role).toBe("memory");
    expect(row?.trackId).toBe("trk_p");
    expect(row?.mime).toBe("image/jpeg");
    expect(await getMemoryPhoto(mem, db)).toBeTruthy();
    // a note-only memory has no photo
    const noteOnly = await addMemory({ trackId: "trk_p", note: "plain" }, db);
    expect(noteOnly.photoBlobId).toBeUndefined();
    expect(await getMemoryPhoto(noteOnly, db)).toBeUndefined();
  });

  it("resolves provider-backed memory photos", async () => {
    const provider = createMemoryProvider("opfs");
    const mem = await addMemory({ trackId: "trk_p", note: "beach" }, db);
    const photo = await putMediaBlob(
      {
        id: "blb_memory_provider_photo",
        trackId: "trk_p",
        role: "memory",
        mime: "image/jpeg",
        blob: new Blob(["memory-photo"], { type: "image/jpeg" }),
      },
      db,
      { provider },
    );
    await db.memories.update(mem.id, { photoBlobId: photo.id });
    const reloaded = (await db.memories.get(mem.id)) ?? mem;

    await expect(
      (await getMemoryPhoto(reloaded, db, { providers: [provider] }))?.text(),
    ).resolves.toBe("memory-photo");
  });

  it("stores a memory author snapshot when provided", async () => {
    const mem = await addMemory(
      {
        trackId: "trk_author",
        note: "listened together",
        author: {
          devicePublicId: "dvc_studio",
          displayName: "Studio laptop",
          avatarSeed: "blue",
        },
      },
      db,
    );

    expect(mem.author).toEqual({
      devicePublicId: "dvc_studio",
      displayName: "Studio laptop",
      avatarSeed: "blue",
    });
    expect((await listMemories("trk_author", db))[0]?.author?.displayName).toBe("Studio laptop");
  });

  it("trims empty author snapshot fields while preserving the device id", async () => {
    const mem = await addMemory(
      {
        trackId: "trk_author",
        note: "late train",
        author: {
          devicePublicId: " dvc_phone ",
          displayName: "   ",
          avatarSeed: "",
          avatarUrl: "  ",
        },
      },
      db,
    );

    expect(mem.author).toEqual({ devicePublicId: "dvc_phone" });
  });

  it("edits a memory note in place", async () => {
    const mem = await addMemory({ trackId: "trk_e", note: "typo" }, db);
    await updateMemoryNote(mem.id, "  fixed  ", db);
    const [reloaded] = await listMemories("trk_e", db);
    expect(reloaded.note).toBe("fixed");
  });

  it("stores an optional atSec anchor; absent stays floating", async () => {
    const anchored = await addMemory(
      { trackId: "trk_ts", note: "drop hits", atSec: 98, createdAt: 1 },
      db,
    );
    const floating = await addMemory({ trackId: "trk_ts", note: "no anchor", createdAt: 2 }, db);
    expect(anchored.atSec).toBe(98);
    expect(floating.atSec).toBeUndefined();
    const [a, f] = await listMemories("trk_ts", db);
    expect(a.atSec).toBe(98);
    expect(f.atSec).toBeUndefined();
  });

  it("treats a negative or non-finite atSec as floating (unanchored)", async () => {
    const neg = await addMemory({ trackId: "trk_bad", note: "neg", atSec: -3 }, db);
    const nan = await addMemory({ trackId: "trk_bad", note: "nan", atSec: Number.NaN }, db);
    expect(neg.atSec).toBeUndefined();
    expect(nan.atSec).toBeUndefined();
  });

  it("updateMemory patches note and atSec independently; null clears the anchor", async () => {
    const mem = await addMemory({ trackId: "trk_um", note: "x", atSec: 10 }, db);
    await updateMemory(mem.id, { atSec: 42 }, db);
    expect((await listMemories("trk_um", db))[0]?.atSec).toBe(42);
    // note-only patch leaves the anchor untouched
    await updateMemory(mem.id, { note: "  retimed  " }, db);
    const [afterNote] = await listMemories("trk_um", db);
    expect(afterNote.note).toBe("retimed");
    expect(afterNote.atSec).toBe(42);
    // null clears the anchor → floating
    await updateMemory(mem.id, { atSec: null }, db);
    expect((await listMemories("trk_um", db))[0]?.atSec).toBeUndefined();
  });

  it("updateMemoryNote still edits the note and leaves atSec intact", async () => {
    const mem = await addMemory({ trackId: "trk_un", note: "typo", atSec: 5 }, db);
    await updateMemoryNote(mem.id, "fixed", db);
    const [reloaded] = await listMemories("trk_un", db);
    expect(reloaded.note).toBe("fixed");
    expect(reloaded.atSec).toBe(5);
  });

  it("deletes a memory and its photo blob", async () => {
    const photo = new Blob([new Uint8Array([1])], { type: "image/png" });
    const mem = await addMemory(
      { trackId: "trk_d", note: "x", photo: { blob: photo, mime: "image/png" } },
      db,
    );
    const photoId = mem.photoBlobId ?? "";
    await deleteMemory(mem.id, db);
    expect(await listMemories("trk_d", db)).toHaveLength(0);
    expect(await db.mediaBlobs.get(photoId)).toBeUndefined();
  });

  it("maps memory notes by trackId (for search joins + DJ context)", async () => {
    await addMemory({ trackId: "trk_a", note: "one", createdAt: 1 }, db);
    await addMemory({ trackId: "trk_a", note: "two", createdAt: 2 }, db);
    await addMemory({ trackId: "trk_b", note: "solo", createdAt: 1 }, db);
    const map = await memoryNotesByTrack(["trk_a", "trk_b", "trk_none"], db);
    expect(map.get("trk_a")).toEqual(["one", "two"]);
    expect(map.get("trk_b")).toEqual(["solo"]);
    expect(map.has("trk_none")).toBe(false);
  });
});

describe("v3 → v4 migration moves Track.note into a first Memory", () => {
  it("backfills each noted track with one memory, skipping empty notes", async () => {
    const name = `muzero-mig4-${Math.random().toString(36).slice(2)}`;
    // Build a v3-era database (no memories table) with two tracks: one noted, one not.
    const v3 = new Dexie(name);
    v3.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v3.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
    });
    v3.version(3).stores({ playQueue: "id" });
    await v3.open();
    await v3.table("tracks").bulkPut([
      { id: "noted", sessionId: "s", status: "ready", createdAt: 100, note: "our wedding song" },
      { id: "blank", sessionId: "s", status: "ready", createdAt: 200, note: "   " },
      { id: "none", sessionId: "s", status: "ready", createdAt: 300 },
    ]);
    v3.close();

    // Reopening as MuzeroDB (v4) runs the upgrade → note becomes a Memory.
    const mz = new MuzeroDB(name);
    try {
      const noted = await listMemories("noted", mz);
      expect(noted).toHaveLength(1);
      expect(noted[0].note).toBe("our wedding song");
      expect(noted[0].createdAt).toBe(100); // preserves the track's timestamp
      expect(await listMemories("blank", mz)).toHaveLength(0); // whitespace-only skipped
      expect(await listMemories("none", mz)).toHaveLength(0);
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

describe("v15 → v16 migration backfills memory authors", () => {
  it("marks existing local memories as unknown local authors", async () => {
    const name = `muzero-mig16-${Math.random().toString(36).slice(2)}`;
    const v15 = new Dexie(name);
    v15.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v15.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v15.version(3).stores({ playQueue: "id" });
    v15.version(4).stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" });
    v15.version(5).stores({ chatSessions: "id, updatedAt" });
    v15.version(11).stores({
      remoteSearchCatalogs: "id, scope, syncedAt, updatedAt",
      remoteSearchTracks: "id, catalogId, trackId, *setIds, *shareIds, *tags, updatedAt",
      remoteSearchSets: "id, catalogId, setId, updatedAt",
    });
    v15.version(12).stores({
      cloudDrives: "id, kind, provider, updatedAt, lastSyncedAt",
      cloudShares: "id, driveId, remoteShareId, access, lastSyncedAt",
    });
    v15.version(13).stores({
      syncRuns: "id, driveId, direction, status, startedAt",
      syncObjects: "id, driveId, key, kind, sourceSetId, sourceTrackId, updatedAt, lastUploadedAt",
    });
    v15.version(14).stores({
      devices: "id, publicId, lastSeenAt",
      trackPlaybackStats: "id, trackId, devicePublicId, updatedAt, [trackId+devicePublicId]",
      playbackEvents: "id, devicePublicId, startedAt, trackId, [devicePublicId+startedAt]",
      playbackAggregates: "id, devicePublicId, scope, driveId, shareId, setId, trackId, updatedAt",
    });
    v15.version(15).stores({
      syncMutations: "id, driveId, devicePublicId, scope, entityId, createdAt, syncedAt",
    });
    await v15.open();
    await v15.table("memories").bulkPut([
      { id: "mem_1", trackId: "trk_1", note: "old", createdAt: 1 },
      {
        id: "mem_2",
        trackId: "trk_1",
        note: "already attributed",
        author: { devicePublicId: "dvc_existing", displayName: "Existing" },
        createdAt: 2,
      },
    ]);
    v15.close();

    const mz = new MuzeroDB(name);
    try {
      const memories = await listMemories("trk_1", mz);
      expect(memories[0]?.author).toEqual({
        devicePublicId: "unknown-local",
        displayName: "Unknown local device",
      });
      expect(memories[1]?.author).toEqual({
        devicePublicId: "dvc_existing",
        displayName: "Existing",
      });
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

describe("v6 → v7 migration downgrades inherited Pixi background defaults", () => {
  it("moves previously persisted noise backgrounds back to the stable image renderer", async () => {
    const name = `muzero-mig7-${Math.random().toString(36).slice(2)}`;
    const v6 = new Dexie(name);
    v6.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v6.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
    });
    v6.version(3).stores({ playQueue: "id" });
    v6.version(4).stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" });
    v6.version(5).stores({ chatSessions: "id, updatedAt" });
    v6.version(6).stores({});
    await v6.open();
    await v6.table("settings").put({ id: "app", backgroundRenderer: "noise" });
    v6.close();

    const mz = new MuzeroDB(name);
    try {
      expect((await getSettings(mz)).backgroundRenderer).toBe("image");
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

describe("v7 → v8 migration disables inherited background visualizer defaults", () => {
  it("moves previously persisted background visualizers back to off", async () => {
    const name = `muzero-mig8-${Math.random().toString(36).slice(2)}`;
    const v7 = new Dexie(name);
    v7.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v7.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
    });
    v7.version(3).stores({ playQueue: "id" });
    v7.version(4).stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" });
    v7.version(5).stores({ chatSessions: "id, updatedAt" });
    v7.version(6).stores({});
    v7.version(7).stores({});
    await v7.open();
    await v7.table("settings").put({
      id: "app",
      visualizerAsBackground: true,
      visualizerIdleOnly: true,
    });
    v7.close();

    const mz = new MuzeroDB(name);
    try {
      const settings = await getSettings(mz);
      expect(settings.visualizerAsBackground).toBe(false);
      expect(settings.visualizerIdleOnly).toBe(false);
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

describe("v9 → v10 migration removes legacy boot-resume pointers", () => {
  it("clears the saved session and track index that used to auto-cue media on launch", async () => {
    const name = `muzero-mig10-${Math.random().toString(36).slice(2)}`;
    const v9 = new Dexie(name);
    v9.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v9.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
    });
    v9.version(3).stores({ playQueue: "id" });
    v9.version(4).stores({ memories: "id, trackId, createdAt, [trackId+createdAt]" });
    v9.version(5).stores({ chatSessions: "id, updatedAt" });
    v9.version(6).stores({});
    v9.version(7).stores({});
    v9.version(8).stores({});
    v9.version(9).stores({});
    await v9.open();
    await v9.table("settings").put({
      id: "app",
      lastSessionId: "ses_previous",
      lastTrackIndex: 2,
    });
    v9.close();

    const mz = new MuzeroDB(name);
    try {
      const settings = await getSettings(mz);
      expect(settings.lastSessionId).toBeUndefined();
      expect(settings.lastTrackIndex).toBeUndefined();
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

describe("import-folder provenance + watch list", () => {
  it("persists sourcePath and queries it via knownSourcePaths", async () => {
    const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const make = (path: string) =>
      createUploadedTrack(
        {
          sessionId: session.id,
          title: path,
          kind: "audio",
          blob: new Blob([new Uint8Array([1])], { type: "audio/mpeg" }),
          mime: "audio/mpeg",
          durationSec: 1,
          sourcePath: path,
        },
        db,
      );
    await make("/music/a.mp3");
    await make("/music/b.mp3");

    const known = await knownSourcePaths(["/music/a.mp3", "/music/c.mp3"], db);
    expect(known).toEqual(new Set(["/music/a.mp3"]));
    expect(await knownSourcePaths([], db)).toEqual(new Set());
  });

  it("upserts folders by id-or-path without dropping others, and removes by id", async () => {
    const id1 = await upsertImportFolder(
      { path: "/m/one", setId: "ses_1", displayName: "one" },
      db,
    );
    const id2 = await upsertImportFolder(
      { path: "/m/two", setId: "ses_2", displayName: "two" },
      db,
    );
    expect(id1).not.toBe(id2);

    // Re-adding the same path (no id) merges into the existing entry, keeping its
    // stable id + untouched fields (displayName), and never grows the list.
    await upsertImportFolder({ path: "/m/one", setId: "ses_1b", lastImportedCount: 3 }, db);
    let folders = (await getSettings(db)).importFolders ?? [];
    expect(folders).toHaveLength(2);
    const one = folders.find((f) => f.id === id1);
    expect(one?.setId).toBe("ses_1b");
    expect(one?.lastImportedCount).toBe(3);
    expect(one?.displayName).toBe("one");

    await removeImportFolder(id1, db);
    folders = (await getSettings(db)).importFolders ?? [];
    expect(folders.map((f) => f.id)).toEqual([id2]);
  });
});

describe("delete (tracks / sets across the multi-set model)", () => {
  const newSet = () => createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
  const makeTrack = (sessionId: string, title: string) =>
    createUploadedTrack(
      {
        sessionId,
        title,
        kind: "audio",
        blob: new Blob([new Uint8Array(4)]),
        mime: "audio/mpeg",
        durationSec: 1,
      },
      db,
    );

  it("deleteTrack removes the track from EVERY set, its blobs, and the play queue", async () => {
    const a = await newSet();
    const b = await newSet();
    const t = await makeTrack(a.id, "shared");
    await prependTrackIds(a.id, [t.id], db);
    await prependTrackIds(b.id, [t.id], db);
    await playQueueSet([t.id], {}, db);

    await deleteTrack(t.id, db);

    expect((await getSession(a.id, db))?.trackIds).toEqual([]);
    expect((await getSession(b.id, db))?.trackIds).toEqual([]); // the multi-set fix
    expect(await getTrack(t.id, db)).toBeUndefined();
    expect(await db.mediaBlobs.where("trackId").equals(t.id).count()).toBe(0);
    expect((await getPlayQueue(db)).entries).toEqual([]);
  });

  it("deleteTracks deletes several at once, keeping the rest", async () => {
    const s = await newSet();
    const t1 = await makeTrack(s.id, "one");
    const t2 = await makeTrack(s.id, "two");
    const keep = await makeTrack(s.id, "keep");
    await prependTrackIds(s.id, [t1.id, t2.id, keep.id], db);

    await deleteTracks([t1.id, t2.id], db);

    expect((await getSession(s.id, db))?.trackIds).toEqual([keep.id]);
    expect(await getTrack(t1.id, db)).toBeUndefined();
    expect(await getTrack(t2.id, db)).toBeUndefined();
    expect(await getTrack(keep.id, db)).toBeDefined();
  });

  it("removeTracksFromSession unlinks from ONE set, keeping the track + other sets + queue", async () => {
    const a = await newSet();
    const b = await newSet();
    const t = await makeTrack(a.id, "shared");
    await prependTrackIds(a.id, [t.id], db);
    await prependTrackIds(b.id, [t.id], db);
    await playQueueSet([t.id], {}, db);

    await removeTracksFromSession(a.id, [t.id], db);

    expect((await getSession(a.id, db))?.trackIds).toEqual([]);
    expect((await getSession(b.id, db))?.trackIds).toEqual([t.id]); // still in B
    expect(await getTrack(t.id, db)).toBeDefined(); // track + blob intact
    expect(await db.mediaBlobs.where("trackId").equals(t.id).count()).toBeGreaterThan(0);
    expect((await getPlayQueue(db)).entries).toHaveLength(1); // queue untouched
  });

  it("deleteSession delete-only keeps songs (in 所有歌曲) and drops bound import folders", async () => {
    const s = await newSet();
    const t = await makeTrack(s.id, "keep me");
    await prependTrackIds(s.id, [t.id], db);
    await setSessionCover(
      { sessionId: s.id, blob: new Blob([new Uint8Array(2)]), mime: "image/png" },
      db,
    );
    await upsertImportFolder({ path: "/m/x", setId: s.id, displayName: "x" }, db);

    const res = await deleteSession(s.id, { purgeExclusiveTracks: false }, db);

    expect(res.purgedTrackIds).toEqual([]);
    expect(await getSession(s.id, db)).toBeUndefined();
    expect(await getTrack(t.id, db)).toBeDefined(); // song survives globally
    expect((await getSettings(db)).importFolders ?? []).toEqual([]); // watch dropped
  });

  it("deleteSession purge deletes ONLY songs exclusive to this set; shared songs survive", async () => {
    const a = await newSet();
    const b = await newSet();
    const exclusive = await makeTrack(a.id, "only in A");
    const shared = await makeTrack(a.id, "in A and B");
    await prependTrackIds(a.id, [exclusive.id, shared.id], db);
    await prependTrackIds(b.id, [shared.id], db);
    await playQueueSet([exclusive.id, shared.id], {}, db);

    const res = await deleteSession(a.id, { purgeExclusiveTracks: true }, db);

    expect(res.purgedTrackIds).toEqual([exclusive.id]);
    expect(await getTrack(exclusive.id, db)).toBeUndefined();
    expect(await db.mediaBlobs.where("trackId").equals(exclusive.id).count()).toBe(0);
    expect(await getTrack(shared.id, db)).toBeDefined(); // shared kept
    expect((await getSession(b.id, db))?.trackIds).toEqual([shared.id]);
    expect((await getPlayQueue(db)).entries.map((e) => e.trackId)).toEqual([shared.id]);
  });
});

describe("set removal tombstones (co-editing, R2 PRD §12.5)", () => {
  async function seedSetWithTrack() {
    const session = await createSession({ seedPrompt: "", config: {}, displayMode: "cover" }, db);
    const track = await createUploadedTrack(
      {
        sessionId: session.id,
        title: "Blue",
        kind: "audio",
        blob: new Blob(["a"], { type: "audio/mpeg" }),
        mime: "audio/mpeg",
        durationSec: 10,
      },
      db,
    );
    await prependTrackIds(session.id, [track.id], db);
    return { session, track };
  }

  it("removing a track from a set records a tombstone", async () => {
    const { session, track } = await seedSetWithTrack();

    await removeTracksFromSession(session.id, [track.id], db);

    const updated = await db.sessions.get(session.id);
    expect(updated?.trackIds).toEqual([]);
    expect(updated?.removedTracks?.[track.id]).toBeGreaterThan(0);
  });

  it("re-adding a removed track clears its tombstone", async () => {
    const { session, track } = await seedSetWithTrack();
    await removeTracksFromSession(session.id, [track.id], db);

    await prependTrackIds(session.id, [track.id], db);

    const updated = await db.sessions.get(session.id);
    expect(updated?.trackIds).toEqual([track.id]);
    expect(updated?.removedTracks?.[track.id]).toBeUndefined();
  });

  it("deleting a track everywhere tombstones it in every containing set", async () => {
    const { session, track } = await seedSetWithTrack();
    const other = await createSession({ seedPrompt: "", config: {}, displayMode: "cover" }, db);
    await prependTrackIds(other.id, [track.id], db);

    await deleteTracks([track.id], db);

    expect((await db.sessions.get(session.id))?.removedTracks?.[track.id]).toBeGreaterThan(0);
    expect((await db.sessions.get(other.id))?.removedTracks?.[track.id]).toBeGreaterThan(0);
  });
});

import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import {
  addMemory,
  createPendingTrack,
  createSession,
  createUploadedTrack,
  deleteMemory,
  getAllTags,
  getMemoryPhoto,
  getSession,
  getSessionCover,
  getTrack,
  listAllTracks,
  listMemories,
  memoryNotesByTrack,
  prependTrackIds,
  setSessionCover,
  setTrackNote,
  setTrackTags,
  updateMemoryNote,
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

describe("prependTrackIds", () => {
  it("adds new tracks to the FRONT (newest on top)", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    await prependTrackIds(s.id, ["a", "b"], db);
    await prependTrackIds(s.id, ["c"], db);
    const got = await getSession(s.id, db);
    expect(got?.trackIds).toEqual(["c", "a", "b"]);
  });
});

describe("setSessionCover / getSessionCover", () => {
  it("stores a set-level cover and reads it back", async () => {
    const s = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: "image/png" });
    await setSessionCover(s.id, blob, "image/png", db);
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

  it("edits a memory note in place", async () => {
    const mem = await addMemory({ trackId: "trk_e", note: "typo" }, db);
    await updateMemoryNote(mem.id, "  fixed  ", db);
    const [reloaded] = await listMemories("trk_e", db);
    expect(reloaded.note).toBe("fixed");
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

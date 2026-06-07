import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import {
  createSession,
  createUploadedTrack,
  getAllTags,
  getSession,
  getSessionCover,
  getTrack,
  listAllTracks,
  prependTrackIds,
  setSessionCover,
  setTrackNote,
  setTrackTags,
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

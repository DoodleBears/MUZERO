import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import {
  getPlayQueue,
  playQueueAppend,
  playQueuePlayNext,
  playQueueRemove,
  playQueueReorder,
  playQueueSet,
  playQueueSetContext,
  playQueueSetIndex,
  playQueueSetRepeat,
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

const trackIds = (pq: { entries: { trackId: string }[] }) => pq.entries.map((e) => e.trackId);

describe("playQueue repo", () => {
  it("getPlayQueue returns an empty singleton when none exists", async () => {
    const pq = await getPlayQueue(db);
    expect(pq.id).toBe("main");
    expect(pq.entries).toEqual([]);
    expect(pq.currentIndex).toBe(-1);
    expect(pq.repeat).toBe("off");
  });

  it("playQueueSet replaces all entries, sets index + context, persists", async () => {
    await playQueueSet(["a", "b", "c"], { contextSetId: "ses_1", currentIndex: 1 }, db);
    const pq = await getPlayQueue(db);
    expect(trackIds(pq)).toEqual(["a", "b", "c"]);
    expect(pq.currentIndex).toBe(1);
    expect(pq.contextSetId).toBe("ses_1");
    // entries carry distinct ids
    expect(new Set(pq.entries.map((e) => e.id)).size).toBe(3);
  });

  it("playQueueAppend adds to the end", async () => {
    await playQueueSet(["a"], {}, db);
    await playQueueAppend(["b", "c"], db);
    expect(trackIds(await getPlayQueue(db))).toEqual(["a", "b", "c"]);
  });

  it("playQueuePlayNext inserts after the current track", async () => {
    await playQueueSet(["a", "b"], { currentIndex: 0 }, db);
    await playQueuePlayNext(["x"], db);
    expect(trackIds(await getPlayQueue(db))).toEqual(["a", "x", "b"]);
  });

  it("playQueueRemove removes an entry by id", async () => {
    await playQueueSet(["a", "b", "c"], {}, db);
    const before = await getPlayQueue(db);
    const bId = before.entries[1].id;
    await playQueueRemove(bId, db);
    expect(trackIds(await getPlayQueue(db))).toEqual(["a", "c"]);
  });

  it("playQueueReorder moves an entry", async () => {
    await playQueueSet(["a", "b", "c"], { currentIndex: 0 }, db);
    await playQueueReorder(2, 0, db); // c to front
    expect(trackIds(await getPlayQueue(db))).toEqual(["c", "a", "b"]);
  });

  it("setIndex / setRepeat / setContext persist", async () => {
    await playQueueSet(["a", "b"], {}, db);
    await playQueueSetIndex(1, db);
    await playQueueSetRepeat("all", db);
    await playQueueSetContext("ses_9", db);
    const pq = await getPlayQueue(db);
    expect(pq.currentIndex).toBe(1);
    expect(pq.repeat).toBe("all");
    expect(pq.contextSetId).toBe("ses_9");
  });
});

describe("v2 → v3 migration seeds the play queue from the resume point", () => {
  it("loads the last-played set's tracks at the resume index", async () => {
    const name = `muzero-mig-${Math.random().toString(36).slice(2)}`;
    // Build a v2-era database (no playQueue table) with a resume point.
    const v2 = new Dexie(name);
    v2.version(1).stores({
      tracks: "id, sessionId, status, createdAt, liked",
      mediaBlobs: "id, trackId",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    v2.version(2).stores({
      tracks: "id, sessionId, status, createdAt, liked, *tags, kind",
      mediaBlobs: "id, trackId, role",
      sessions: "id, status, updatedAt",
      settings: "id",
    });
    await v2.open();
    await v2.table("sessions").put({
      id: "ses_x",
      name: "Set",
      seedPrompt: "",
      trackIds: ["a", "b", "c"],
      status: "idle",
      config: { autoExtend: true },
      displayMode: "video",
      createdAt: 1,
      updatedAt: 1,
    });
    await v2.table("settings").put({ id: "app", lastSessionId: "ses_x", lastTrackIndex: 1 });
    v2.close();

    // Reopening as MuzeroDB (v3) triggers the upgrade → seeded play queue.
    const mz = new MuzeroDB(name);
    try {
      const pq = await getPlayQueue(mz);
      expect(pq.entries.map((e) => e.trackId)).toEqual(["a", "b", "c"]);
      expect(pq.currentIndex).toBe(1);
      expect(pq.contextSetId).toBe("ses_x");
    } finally {
      mz.close();
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = req.onerror = () => resolve();
      });
    }
  });
});

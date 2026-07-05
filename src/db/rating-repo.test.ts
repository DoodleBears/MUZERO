import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import {
  clearTrackRating,
  clearTracksRating,
  createSession,
  createUploadedTrack,
  getTrack,
  setTrackRating,
  setTracksRating,
} from "./repositories";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-rating-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = request.onerror = () => resolve();
  });
});

async function track() {
  const session = await createSession({ seedPrompt: "", config: { autoExtend: false } }, db);
  return createUploadedTrack(
    {
      sessionId: session.id,
      title: "T",
      kind: "audio",
      blob: new Blob(["a"], { type: "audio/mpeg" }),
      mime: "audio/mpeg",
      durationSec: 100,
    },
    db,
  );
}

describe("setTrackRating", () => {
  it("records a clamped vote per rater", async () => {
    const t = await track();
    await setTrackRating(t.id, "self", 9, db); // clamp → 5
    await setTrackRating(t.id, "bili:1", 4, db);
    const row = await getTrack(t.id, db);
    expect(row?.ratingsByRater).toEqual({ self: 5, "bili:1": 4 });
  });

  it("dedupes: a rater's re-vote overwrites, not appends", async () => {
    const t = await track();
    await setTrackRating(t.id, "bili:1", 5, db);
    await setTrackRating(t.id, "bili:1", 2, db);
    const row = await getTrack(t.id, db);
    expect(row?.ratingsByRater).toEqual({ "bili:1": 2 });
  });

  it("bumps the track's updatedAt clock", async () => {
    const t = await track();
    await setTrackRating(t.id, "self", 5, db);
    const row = await getTrack(t.id, db);
    expect(row?.updatedAt ?? 0).toBeGreaterThan(0);
  });
});

describe("clearTrackRating", () => {
  it("removes only the given rater's vote", async () => {
    const t = await track();
    await setTrackRating(t.id, "self", 5, db);
    await setTrackRating(t.id, "bili:1", 3, db);
    await clearTrackRating(t.id, "self", db);
    const row = await getTrack(t.id, db);
    expect(row?.ratingsByRater).toEqual({ "bili:1": 3 });
  });

  it("drops the map entirely when the last vote is cleared", async () => {
    const t = await track();
    await setTrackRating(t.id, "self", 4, db);
    await clearTrackRating(t.id, "self", db);
    const row = await getTrack(t.id, db);
    expect(row?.ratingsByRater).toBeUndefined();
  });

  it("is a no-op when the rater never voted", async () => {
    const t = await track();
    await setTrackRating(t.id, "bili:1", 2, db);
    await clearTrackRating(t.id, "self", db);
    const row = await getTrack(t.id, db);
    expect(row?.ratingsByRater).toEqual({ "bili:1": 2 });
  });
});

describe("setTracksRating / clearTracksRating (batch)", () => {
  it("records the same clamped self vote across many tracks", async () => {
    const [a, b] = [await track(), await track()];
    await setTrackRating(b.id, "bili:1", 3, db); // pre-existing audience vote is preserved
    await setTracksRating([a.id, b.id], "self", 9, db); // clamp → 5
    expect((await getTrack(a.id, db))?.ratingsByRater).toEqual({ self: 5 });
    expect((await getTrack(b.id, db))?.ratingsByRater).toEqual({ "bili:1": 3, self: 5 });
  });

  it("clears the self vote across many tracks, leaving others", async () => {
    const [a, b] = [await track(), await track()];
    await setTracksRating([a.id, b.id], "self", 4, db);
    await setTrackRating(a.id, "bili:1", 2, db);
    await clearTracksRating([a.id, b.id], "self", db);
    expect((await getTrack(a.id, db))?.ratingsByRater).toEqual({ "bili:1": 2 });
    expect((await getTrack(b.id, db))?.ratingsByRater).toBeUndefined();
  });

  it("is a no-op for an empty id list", async () => {
    const a = await track();
    await setTracksRating([], "self", 5, db);
    expect((await getTrack(a.id, db))?.ratingsByRater).toBeUndefined();
  });
});

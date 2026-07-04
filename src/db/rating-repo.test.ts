import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import { createSession, createUploadedTrack, getTrack, setTrackRating } from "./repositories";

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

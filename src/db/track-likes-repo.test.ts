import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "./muzero-db";
import { isTrackLiked, likedTrackIdSet, setTrackLiked } from "./repositories";
import { likeRowsFromLegacyTracks } from "./track-likes";
import type { Track } from "./types";

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

async function seedTrack(id: string, liked = false): Promise<void> {
  await db.tracks.add({ id, liked } as unknown as Track);
}

describe("track likes side table (Axis A — liked off catalog)", () => {
  it("setTrackLiked writes the side table and never touches the tracks row", async () => {
    await seedTrack("trk_1", false);
    await setTrackLiked("trk_1", true, db);
    expect(await isTrackLiked("trk_1", db)).toBe(true);
    // The cold catalog row must stay untouched (this is what kills the liveQuery fan-out).
    expect((await db.tracks.get("trk_1"))?.liked).toBe(false);
    expect((await db.trackLikes.get("trk_1"))?.trackId).toBe("trk_1");
  });

  it("unliking deletes the side-table row (presence = liked)", async () => {
    await seedTrack("trk_1");
    await setTrackLiked("trk_1", true, db);
    await setTrackLiked("trk_1", false, db);
    expect(await isTrackLiked("trk_1", db)).toBe(false);
    expect(await db.trackLikes.get("trk_1")).toBeUndefined();
  });

  it("likedTrackIdSet returns exactly the liked ids", async () => {
    await seedTrack("a");
    await seedTrack("b");
    await seedTrack("c");
    await setTrackLiked("a", true, db);
    await setTrackLiked("c", true, db);
    expect(await likedTrackIdSet(db)).toEqual(new Set(["a", "c"]));
  });

  it("isTrackLiked is false for an absent / unliked track", async () => {
    expect(await isTrackLiked("missing", db)).toBe(false);
  });
});

describe("likeRowsFromLegacyTracks (v26 backfill mapper, pure)", () => {
  it("maps only liked legacy tracks to trackLikes rows", () => {
    const rows = likeRowsFromLegacyTracks(
      [
        { id: "a", liked: true },
        { id: "b", liked: false },
        { id: "c", liked: true },
        { id: "d" }, // liked undefined → not liked
      ],
      111,
    );
    expect(rows).toEqual([
      { trackId: "a", likedAt: 111 },
      { trackId: "c", likedAt: 111 },
    ]);
  });

  it("returns [] when nothing is liked", () => {
    expect(likeRowsFromLegacyTracks([{ id: "a", liked: false }], 1)).toEqual([]);
  });
});

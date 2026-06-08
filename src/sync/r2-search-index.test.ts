import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  importRemoteSetSearchPage,
  importRemoteTrackSearchPage,
  searchRemoteTracks,
} from "./r2-search-index";

let db: MuzeroDB;
let dbName: string;

beforeEach(() => {
  dbName = `muzero-remote-search-${Math.random().toString(36).slice(2)}`;
  db = new MuzeroDB(dbName);
});

afterEach(async () => {
  db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = req.onerror = () => resolve();
  });
});

describe("remote search index", () => {
  it("imports remote track search rows into IndexedDB", async () => {
    await importRemoteTrackSearchPage(
      {
        catalogId: "drv_a:lib_abc",
        driveId: "drv_a",
        page: {
          schema: "muzero-r2-track-search-page-v1",
          page: 1,
          updatedAt: "2026-06-09T00:00:00.000Z",
          tracks: [
            {
              id: "trk_blue",
              title: "Blue Highway",
              setIds: ["ses_tokyo"],
              shareIds: ["shr_tokyo"],
              kind: "audio",
              origin: "uploaded",
              durationSec: 214,
              tags: ["night", "drive"],
              memoryText: "friends sea night",
              briefCaption: null,
              artistLike: null,
              updatedAt: 1780944000000,
              mediaAvailable: true,
              coverUrl: "objects/covers/trk_blue.jpg",
            },
          ],
        },
      },
      db,
    );

    const rows = await db.remoteSearchTracks.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "drv_a:lib_abc:trk_blue",
      driveId: "drv_a",
      trackId: "trk_blue",
      title: "Blue Highway",
      mediaAvailable: true,
    });
  });

  it("queries remote track rows by normalized text and tag", async () => {
    await importRemoteTrackSearchPage(
      {
        catalogId: "drv_a:lib_abc",
        driveId: "drv_a",
        page: {
          schema: "muzero-r2-track-search-page-v1",
          page: 1,
          updatedAt: "2026-06-09T00:00:00.000Z",
          tracks: [
            {
              id: "trk_blue",
              title: "Blue Highway",
              setIds: ["ses_tokyo"],
              shareIds: ["shr_tokyo"],
              kind: "audio",
              origin: "uploaded",
              durationSec: 214,
              tags: ["night", "drive"],
              memoryText: "friends sea night",
              briefCaption: null,
              artistLike: null,
              updatedAt: 1780944000000,
              mediaAvailable: true,
            },
            {
              id: "trk_red",
              title: "Red Gym",
              setIds: ["ses_workout"],
              shareIds: [],
              kind: "audio",
              origin: "uploaded",
              durationSec: 180,
              tags: ["workout"],
              memoryText: null,
              briefCaption: null,
              artistLike: null,
              updatedAt: 1780945000000,
              mediaAvailable: true,
            },
          ],
        },
      },
      db,
    );

    expect((await searchRemoteTracks("blue sea", db)).map((row) => row.trackId)).toEqual([
      "trk_blue",
    ]);
    expect((await searchRemoteTracks("#workout", db)).map((row) => row.trackId)).toEqual([
      "trk_red",
    ]);
  });

  it("imports remote set search rows into IndexedDB", async () => {
    await importRemoteSetSearchPage(
      {
        catalogId: "drv_a:lib_abc",
        driveId: "drv_a",
        page: {
          schema: "muzero-r2-set-search-page-v1",
          page: 1,
          updatedAt: "2026-06-09T00:00:00.000Z",
          sets: [
            {
              id: "ses_tokyo",
              name: "Tokyo Night Drive",
              description: "Rainy city pop",
              trackCount: 24,
              coverUrl: "objects/covers/set.jpg",
              updatedAt: 1780944000000,
            },
          ],
        },
      },
      db,
    );

    const rows = await db.remoteSearchSets.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "drv_a:lib_abc:ses_tokyo",
      setId: "ses_tokyo",
      name: "Tokyo Night Drive",
      trackCount: 24,
    });
  });
});

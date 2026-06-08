import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MuzeroDB } from "@/db/muzero-db";
import {
  importRemoteSearchCatalog,
  importRemoteSetSearchPage,
  importRemoteTrackSearchPage,
  type SyncCatalogFetch,
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fetchMap(entries: Record<string, unknown>): SyncCatalogFetch {
  return async (input) => {
    const hit = entries[String(input)];
    if (!hit) return new Response("missing", { status: 404 });
    return jsonResponse(hit);
  };
}

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

  it("fetches a remote catalog and imports paged set/track rows", async () => {
    await importRemoteSearchCatalog(
      {
        catalogId: "drv_a:lib_abc",
        driveId: "drv_a",
        scope: "library",
        baseUrl: "https://music.example.com/muzero/",
        catalogUrl: "https://music.example.com/muzero/catalog/library.json",
        fetcher: fetchMap({
          "https://music.example.com/muzero/catalog/library.json": {
            schema: "muzero-r2-search-catalog-v1",
            libraryId: "lib_abc",
            updatedAt: "2026-06-09T00:00:00.000Z",
            locale: "en",
            pages: {
              sets: ["catalog/sets-page-0001.json"],
              tracks: ["catalog/tracks-page-0001.json"],
              shares: [],
            },
            counts: {
              sets: 1,
              tracks: 1,
              shares: 0,
            },
          },
          "https://music.example.com/muzero/catalog/tracks-page-0001.json": {
            schema: "muzero-r2-track-search-page-v1",
            page: 1,
            updatedAt: "2026-06-09T00:00:00.000Z",
            tracks: [
              {
                id: "trk_blue",
                title: "Blue Highway",
                setIds: ["ses_tokyo"],
                shareIds: [],
                kind: "audio",
                origin: "uploaded",
                durationSec: 214,
                tags: ["night"],
                memoryText: "friends sea night",
                briefCaption: null,
                artistLike: null,
                updatedAt: 1780944000000,
                mediaAvailable: true,
              },
            ],
          },
          "https://music.example.com/muzero/catalog/sets-page-0001.json": {
            schema: "muzero-r2-set-search-page-v1",
            page: 1,
            updatedAt: "2026-06-09T00:00:00.000Z",
            sets: [
              {
                id: "ses_tokyo",
                name: "Tokyo Night Drive",
                trackCount: 1,
                updatedAt: 1780944000000,
              },
            ],
          },
        }),
      },
      db,
    );

    expect(await db.remoteSearchCatalogs.get("drv_a:lib_abc")).toMatchObject({
      driveId: "drv_a",
      scope: "library",
      trackCount: 1,
      setCount: 1,
    });
    expect((await searchRemoteTracks("blue sea", db)).map((row) => row.trackId)).toEqual([
      "trk_blue",
    ]);
    expect(await db.remoteSearchSets.count()).toBe(1);
  });

  it("skips unchanged catalog pages when page metadata is stable", async () => {
    const seen: string[] = [];
    const fetcher: SyncCatalogFetch = async (input) => {
      const url = String(input);
      seen.push(url);
      return fetchMap({
        "https://music.example.com/muzero/catalog/library.json": {
          schema: "muzero-r2-search-catalog-v1",
          libraryId: "lib_abc",
          updatedAt: "2026-06-09T00:00:00.000Z",
          locale: "en",
          pages: {
            sets: [{ path: "catalog/sets-page-0001.json", updatedAt: "same-set-page" }],
            tracks: [{ path: "catalog/tracks-page-0001.json", updatedAt: "same-track-page" }],
            shares: [],
          },
          counts: {
            sets: 1,
            tracks: 1,
            shares: 0,
          },
        },
        "https://music.example.com/muzero/catalog/tracks-page-0001.json": {
          schema: "muzero-r2-track-search-page-v1",
          page: 1,
          updatedAt: "2026-06-09T00:00:00.000Z",
          tracks: [
            {
              id: "trk_blue",
              title: "Blue Highway",
              setIds: ["ses_tokyo"],
              shareIds: [],
              kind: "audio",
              origin: "uploaded",
              durationSec: 214,
              tags: ["night"],
              memoryText: "friends sea night",
              briefCaption: null,
              artistLike: null,
              updatedAt: 1780944000000,
              mediaAvailable: true,
            },
          ],
        },
        "https://music.example.com/muzero/catalog/sets-page-0001.json": {
          schema: "muzero-r2-set-search-page-v1",
          page: 1,
          updatedAt: "2026-06-09T00:00:00.000Z",
          sets: [
            {
              id: "ses_tokyo",
              name: "Tokyo Night Drive",
              trackCount: 1,
              updatedAt: 1780944000000,
            },
          ],
        },
      })(input);
    };
    const input = {
      catalogId: "drv_a:lib_abc",
      driveId: "drv_a",
      scope: "library" as const,
      baseUrl: "https://music.example.com/muzero/",
      catalogUrl: "https://music.example.com/muzero/catalog/library.json",
      fetcher,
    };

    await importRemoteSearchCatalog(input, db);
    seen.length = 0;
    await importRemoteSearchCatalog(input, db);

    expect(seen).toEqual(["https://music.example.com/muzero/catalog/library.json"]);
    expect(await db.remoteSearchTracks.count()).toBe(1);
    expect(await db.remoteSearchSets.count()).toBe(1);
    expect(await db.remoteSearchCatalogs.get("drv_a:lib_abc")).toMatchObject({
      pageVersions: {
        "set:https://music.example.com/muzero/catalog/sets-page-0001.json": "same-set-page",
        "track:https://music.example.com/muzero/catalog/tracks-page-0001.json": "same-track-page",
      },
    });
  });
});

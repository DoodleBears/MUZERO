import { describe, expect, it } from "vitest";
import { parseFavFolders, parseFavInfo, parseFavResourceList } from "./bili-playlists";

/** `/x/v3/fav/folder/created/list-all` → the user's created fav folders. */
const FOLDERS = {
  code: 0,
  data: {
    count: 2,
    list: [
      { id: 123, title: "我的收藏", media_count: 42, cover: "//i0.hdslb.com/fav.jpg" },
      { id: 456, title: "音乐", media_count: 7 },
    ],
  },
};

/** `/x/v3/fav/resource/list` → one page of a folder's contents + the folder `info`. */
const RESOURCE = {
  code: 0,
  data: {
    info: { id: 123, title: "我的收藏", media_count: 42, cover: "//i0.hdslb.com/fav.jpg" },
    medias: [
      {
        bvid: "BV1aa",
        title: "视频A",
        cover: "//i0.hdslb.com/a.jpg",
        duration: 200,
        upper: { name: "UP A" },
        page: 1,
      },
      { bvid: "BV1bb", title: "视频B", duration: 100, upper: { name: "UP B" }, page: 3 },
    ],
    has_more: true,
  },
};

describe("parseFavFolders", () => {
  it("maps created fav folders to playlists (id/name/count/cover)", () => {
    const folders = parseFavFolders(FOLDERS);
    expect(folders).toHaveLength(2);
    expect(folders[0]).toEqual({
      source: "bili",
      id: "123",
      name: "我的收藏",
      trackCount: 42,
      coverUrl: "https://i0.hdslb.com/fav.jpg",
    });
    expect(folders[1]).toEqual({
      source: "bili",
      id: "456",
      name: "音乐",
      trackCount: 7,
      coverUrl: undefined,
    });
  });

  it("returns [] for empty/missing data", () => {
    expect(parseFavFolders({})).toEqual([]);
    expect(parseFavFolders({ data: { list: null } })).toEqual([]);
    expect(parseFavFolders(null)).toEqual([]);
  });
});

describe("parseFavResourceList", () => {
  it("maps medias[] to hits and surfaces has_more", () => {
    const { hits, hasMore } = parseFavResourceList(RESOURCE);
    expect(hasMore).toBe(true);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      source: "bili",
      externalId: "BV1aa",
      title: "视频A",
      artist: "UP A",
      durationSec: 200,
      coverUrl: "https://i0.hdslb.com/a.jpg",
    });
    expect(hits[1].externalId).toBe("BV1bb");
  });

  it("drops entries without a bvid (invalid / removed videos)", () => {
    const { hits } = parseFavResourceList({
      data: { medias: [{ title: "失效视频" }, { bvid: "BV1cc", title: "ok" }] },
    });
    expect(hits.map((h) => h.externalId)).toEqual(["BV1cc"]);
  });

  it("returns no hits + hasMore false for empty data", () => {
    expect(parseFavResourceList({})).toEqual({ hits: [], hasMore: false });
    expect(parseFavResourceList({ data: { medias: null } })).toEqual({ hits: [], hasMore: false });
  });
});

describe("parseFavInfo", () => {
  it("reads the folder meta from a resource-list response", () => {
    expect(parseFavInfo(RESOURCE)).toEqual({
      source: "bili",
      id: "123",
      name: "我的收藏",
      trackCount: 42,
      coverUrl: "https://i0.hdslb.com/fav.jpg",
    });
  });

  it("returns null when there is no info", () => {
    expect(parseFavInfo({})).toBeNull();
    expect(parseFavInfo({ data: {} })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_DJ_CONFIG, type DjSession } from "@/db/types";
import { filterSets, type SetGalleryItem, sortSets } from "./set-gallery";

function makeItem(opts: {
  matchesQuery?: (query: string) => boolean;
  name: string;
  seed?: string;
  trackCount?: number;
  likedCount?: number;
  lastActivityAt?: number;
}): SetGalleryItem {
  const session: DjSession = {
    id: `ses_${opts.name}`,
    name: opts.name,
    seedPrompt: opts.seed ?? "",
    trackIds: [],
    status: "idle",
    config: { ...DEFAULT_DJ_CONFIG },
    displayMode: "video",
    createdAt: 0,
    updatedAt: opts.lastActivityAt ?? 0,
  };
  return {
    session,
    trackCount: opts.trackCount ?? 0,
    likedCount: opts.likedCount ?? 0,
    lastActivityAt: opts.lastActivityAt ?? 0,
    matchesQuery: opts.matchesQuery,
  };
}

const names = (items: SetGalleryItem[]) => items.map((i) => i.session.name);

describe("filterSets", () => {
  const items = [
    makeItem({ name: "Late-night lofi", seed: "lofi focus" }),
    makeItem({ name: "Sunrise synthwave", seed: "road trip" }),
    makeItem({ name: "Rainy jazz", seed: "neo-soul", likedCount: 2 }),
  ];

  it("returns all when query is empty and filter is all", () => {
    expect(filterSets(items, "", "all")).toHaveLength(3);
  });

  it("matches the set name case-insensitively", () => {
    expect(names(filterSets(items, "LOFI", "all"))).toEqual(["Late-night lofi"]);
  });

  it("matches the seed prompt", () => {
    expect(names(filterSets(items, "road", "all"))).toEqual(["Sunrise synthwave"]);
  });

  it("can delegate query matching to track and memory search", () => {
    const memoryMatched = makeItem({
      name: "Uploaded memories",
      matchesQuery: (query) => query === "osaka" || query === "#gym",
    });

    expect(names(filterSets([...items, memoryMatched], "osaka", "all"))).toEqual([
      "Uploaded memories",
    ]);
    expect(names(filterSets([...items, memoryMatched], "#gym", "all"))).toEqual([
      "Uploaded memories",
    ]);
  });

  it("filter=liked keeps only sets with liked tracks", () => {
    expect(names(filterSets(items, "", "liked"))).toEqual(["Rainy jazz"]);
  });

  it("combines query and liked filter", () => {
    expect(filterSets(items, "jazz", "liked")).toHaveLength(1);
    expect(filterSets(items, "lofi", "liked")).toHaveLength(0);
  });
});

describe("sortSets", () => {
  const items = [
    makeItem({ name: "Beta", trackCount: 3, lastActivityAt: 100 }),
    makeItem({ name: "Alpha", trackCount: 10, lastActivityAt: 50 }),
    makeItem({ name: "Gamma", trackCount: 1, lastActivityAt: 200 }),
  ];

  it("recent → by last activity desc", () => {
    expect(names(sortSets(items, "recent"))).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("name → alphabetical", () => {
    expect(names(sortSets(items, "name"))).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("size → by track count desc", () => {
    expect(names(sortSets(items, "size"))).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("does not mutate the input array", () => {
    const before = names(items);
    sortSets(items, "name");
    expect(names(items)).toEqual(before);
  });
});

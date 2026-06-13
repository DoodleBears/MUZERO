import { beforeAll, describe, expect, it } from "vitest";
import {
  ENTITY_SORT_DEFAULT_DIR,
  type EntitySort,
  type SortableEntity,
  sortEntities,
} from "./entity-gallery";
import { ensureTransliterationLoaded } from "./search-transliterate";

// The name sort is transliteration-aware; warm the dictionaries so pinyin is full.
beforeAll(async () => {
  await ensureTransliterationLoaded();
});

function ent(over: Partial<SortableEntity> & { name: string }): SortableEntity {
  return {
    trackCount: 0,
    durationSec: 0,
    lastPlayedAt: 0,
    isBucket: false,
    ...over,
  };
}

const names = (items: SortableEntity[]) => items.map((e) => e.name);

describe("sortEntities", () => {
  const items = [
    ent({ name: "Beta", trackCount: 3, durationSec: 600, lastPlayedAt: 100 }),
    ent({ name: "Alpha", trackCount: 10, durationSec: 200, lastPlayedAt: 300 }),
    ent({ name: "Gamma", trackCount: 1, durationSec: 999, lastPlayedAt: 50 }),
  ];

  it("name → alphabetical (A→Z) by default", () => {
    expect(names(sortEntities(items, "name"))).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("name → reading order for CJK (pinyin), so the A–Z index aligns", () => {
    const cjk = [
      ent({ name: "周杰伦" }), // zhōu → Z
      ent({ name: "Adele" }), // A
      ent({ name: "北京" }), // běi → B
    ];
    expect(names(sortEntities(cjk, "name"))).toEqual(["Adele", "北京", "周杰伦"]);
  });

  it("count → most tracks first by default", () => {
    expect(names(sortEntities(items, "count"))).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("duration → longest total first by default", () => {
    expect(names(sortEntities(items, "duration"))).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("played → most-recently-played first by default", () => {
    expect(names(sortEntities(items, "played"))).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("flips with an explicit ascending direction", () => {
    expect(names(sortEntities(items, "count", "asc"))).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(names(sortEntities(items, "name", "desc"))).toEqual(["Gamma", "Beta", "Alpha"]);
  });

  it("pins pseudo-buckets last regardless of field or direction", () => {
    const withBucket = [
      ent({ name: "Unknown Artist", trackCount: 999, durationSec: 9999, isBucket: true }),
      ent({ name: "Solo", trackCount: 2, durationSec: 100 }),
      ent({ name: "Duo", trackCount: 5, durationSec: 500 }),
    ];
    // count desc would put the bucket first by value, but it must stay last
    expect(names(sortEntities(withBucket, "count"))).toEqual(["Duo", "Solo", "Unknown Artist"]);
    // even ascending, the bucket stays at the bottom
    expect(names(sortEntities(withBucket, "count", "asc"))).toEqual([
      "Solo",
      "Duo",
      "Unknown Artist",
    ]);
  });

  it("breaks ties by name (deterministic)", () => {
    const tie = [ent({ name: "Zed", trackCount: 4 }), ent({ name: "Ace", trackCount: 4 })];
    expect(names(sortEntities(tie, "count"))).toEqual(["Ace", "Zed"]);
  });

  it("does not mutate the input array", () => {
    const before = names(items);
    sortEntities(items, "name", "desc");
    expect(names(items)).toEqual(before);
  });

  it("every sort field has a default direction", () => {
    const fields: EntitySort[] = ["name", "count", "duration", "played"];
    for (const f of fields) expect(ENTITY_SORT_DEFAULT_DIR[f]).toMatch(/^(asc|desc)$/);
  });
});

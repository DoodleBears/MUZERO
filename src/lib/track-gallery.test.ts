import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import {
  filterLikedTracks,
  sortTracks,
  TRACK_SORT_DEFAULT_DIR,
  type TrackSort,
} from "./track-gallery";

function makeTrack(over: Partial<Track> & { id: string }): Track {
  return {
    sessionId: "ses_1",
    title: over.id,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 0,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...over,
  };
}

const ids = (tracks: Track[]) => tracks.map((t) => t.id);

describe("sortTracks", () => {
  const tracks = [
    makeTrack({ id: "b", title: "Beta", createdAt: 200, durationSec: 120 }),
    makeTrack({ id: "a", title: "Alpha", createdAt: 100, durationSec: 300 }),
    makeTrack({ id: "c", title: "Gamma", createdAt: 300, durationSec: 60 }),
  ];

  it("name → alphabetical (A→Z) by default", () => {
    expect(ids(sortTracks(tracks, "name"))).toEqual(["a", "b", "c"]);
  });

  it("created → newest first by default", () => {
    expect(ids(sortTracks(tracks, "created"))).toEqual(["c", "b", "a"]);
  });

  it("duration → longest first by default", () => {
    expect(ids(sortTracks(tracks, "duration"))).toEqual(["a", "b", "c"]);
  });

  it("respects an explicit ascending direction (flip)", () => {
    expect(ids(sortTracks(tracks, "created", "asc"))).toEqual(["a", "b", "c"]);
    expect(ids(sortTracks(tracks, "name", "desc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortTracks(tracks, "duration", "asc"))).toEqual(["c", "b", "a"]);
  });

  it("updated → falls back to createdAt when updatedAt is absent", () => {
    const rows = [
      makeTrack({ id: "old-edit", createdAt: 10, updatedAt: 500 }),
      makeTrack({ id: "no-edit", createdAt: 400 }), // no updatedAt → uses 400
      makeTrack({ id: "fresh-create", createdAt: 100, updatedAt: 150 }),
    ];
    expect(ids(sortTracks(rows, "updated"))).toEqual(["old-edit", "no-edit", "fresh-create"]);
  });

  it("played → orders by the lastPlayed map; never-played sink to 0", () => {
    const lastPlayed = new Map([
      ["a", 900],
      ["c", 500],
    ]);
    // b is absent → 0; default desc → a(900), c(500), b(0)
    expect(ids(sortTracks(tracks, "played", undefined, lastPlayed))).toEqual(["a", "c", "b"]);
    expect(ids(sortTracks(tracks, "played", "asc", lastPlayed))).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by title then createdAt (deterministic)", () => {
    const sameDuration = [
      makeTrack({ id: "z", title: "Zed", durationSec: 100, createdAt: 5 }),
      makeTrack({ id: "m", title: "Mid", durationSec: 100, createdAt: 9 }),
    ];
    // equal duration → tiebreak by title A→Z regardless of sign
    expect(ids(sortTracks(sameDuration, "duration"))).toEqual(["m", "z"]);
  });

  it("does not mutate the input array", () => {
    const before = ids(tracks);
    sortTracks(tracks, "name");
    expect(ids(tracks)).toEqual(before);
  });

  it("every sort field has a default direction", () => {
    const fields: TrackSort[] = ["name", "created", "updated", "played", "duration"];
    for (const f of fields) expect(TRACK_SORT_DEFAULT_DIR[f]).toMatch(/^(asc|desc)$/);
  });
});

describe("filterLikedTracks", () => {
  const tracks = [
    makeTrack({ id: "a", liked: true }),
    makeTrack({ id: "b", liked: false }),
    makeTrack({ id: "c", liked: true }),
  ];
  // `liked` now comes from the side table; the filter takes the liked-id set.
  const likedIds = new Set(["a", "c"]);

  it("keeps only liked tracks when on", () => {
    expect(ids(filterLikedTracks(tracks, true, likedIds))).toEqual(["a", "c"]);
  });

  it("passes everything through when off", () => {
    expect(ids(filterLikedTracks(tracks, false, likedIds))).toEqual(["a", "b", "c"]);
  });
});

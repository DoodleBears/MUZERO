import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import {
  filterLikedTracks,
  filterTracksByRating,
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

describe("filterTracksByRating", () => {
  const tracks = [
    makeTrack({ id: "five", ratingsByRater: { self: 5 } }),
    makeTrack({ id: "mid", ratingsByRater: { self: 3, "bili:1": 4 } }), // avg 3.5
    makeTrack({ id: "low", ratingsByRater: { self: 1 } }),
    makeTrack({ id: "unrated" }),
    makeTrack({ id: "empty-votes", ratingsByRater: {} }),
  ];

  it("passes everything through when the range is null", () => {
    expect(ids(filterTracksByRating(tracks, null))).toEqual([
      "five",
      "mid",
      "low",
      "unrated",
      "empty-votes",
    ]);
  });

  it("keeps only tracks whose average falls inside the inclusive window", () => {
    expect(ids(filterTracksByRating(tracks, { min: 3, max: 5 }))).toEqual(["five", "mid"]);
    expect(ids(filterTracksByRating(tracks, { min: 1, max: 3 }))).toEqual(["low"]);
  });

  it("matches the bounds inclusively (a 3.5 average passes max 3.5 and min 3.5)", () => {
    expect(ids(filterTracksByRating(tracks, { min: 3.5, max: 3.5 }))).toEqual(["mid"]);
  });

  it("drops unrated tracks whenever a range is active", () => {
    expect(ids(filterTracksByRating(tracks, { min: 1, max: 5 }))).toEqual(["five", "mid", "low"]);
  });

  it("filters on the crowd AVERAGE, not any single vote", () => {
    // mid averages 3.5 — a 4–5 window excludes it even though one rater voted 4.
    expect(ids(filterTracksByRating(tracks, { min: 4, max: 5 }))).toEqual(["five"]);
  });
});

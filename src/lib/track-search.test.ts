import { describe, expect, it } from "vitest";
import type { Track } from "@/db/types";
import { matchesQuery, searchTracks, tracksWithTag } from "./track-search";

function track(partial: Partial<Track>): Track {
  return {
    id: "t",
    sessionId: "s",
    title: "Untitled",
    kind: "audio",
    origin: "generated",
    provider: "mock",
    status: "ready",
    durationSec: 30,
    createdAt: 0,
    playCount: 0,
    liked: false,
    tags: [],
    ...partial,
  };
}

const neonRain = track({
  id: "a",
  title: "Neon Rain",
  brief: { title: "Neon Rain", caption: "lofi hip hop, mellow piano", lyrics: "", durationSec: 60 },
  note: "summer 2019 road trip with mom",
  tags: ["roadtrip", "nostalgia"],
});
const workout = track({
  id: "b",
  title: "Sprint",
  brief: undefined,
  note: "gym",
  tags: ["workout"],
});

describe("matchesQuery", () => {
  it("matches across title, caption, note, and tags", () => {
    expect(matchesQuery(neonRain, "neon")).toBe(true); // title
    expect(matchesQuery(neonRain, "piano")).toBe(true); // caption
    expect(matchesQuery(neonRain, "road trip")).toBe(true); // note (two tokens, both present)
    expect(matchesQuery(neonRain, "nostalgia")).toBe(true); // tag
    expect(matchesQuery(neonRain, "techno")).toBe(false);
  });

  it("matches imported media metadata", () => {
    const imported = track({
      brief: undefined,
      mediaMetadata: {
        album: "Moonstone Beach",
        artists: ["Deidian"],
        genres: ["soluna"],
        parser: "music-metadata",
        parsedAt: 1,
        year: 2026,
      },
      origin: "uploaded",
      title: "Track 04",
    });
    expect(matchesQuery(imported, "deidian")).toBe(true);
    expect(matchesQuery(imported, "moonstone 2026")).toBe(true);
    expect(matchesQuery(imported, "soluna")).toBe(true);
  });

  it("requires every token to match (AND)", () => {
    expect(matchesQuery(neonRain, "summer mom")).toBe(true);
    expect(matchesQuery(neonRain, "summer techno")).toBe(false);
  });

  it("treats #tag as a tag-only match", () => {
    expect(matchesQuery(neonRain, "#roadtrip")).toBe(true);
    expect(matchesQuery(workout, "#roadtrip")).toBe(false);
    // 'workout' appears as a tag, not in #road
    expect(matchesQuery(workout, "#workout")).toBe(true);
  });

  it("empty query matches everything", () => {
    expect(matchesQuery(workout, "   ")).toBe(true);
  });
});

describe("matchesQuery with memories", () => {
  // After the v4 migration, recollections live in the memories table — passed in
  // as notes rather than read off `track.note`.
  const song = track({ id: "c", title: "Drift", note: undefined, tags: ["chill"] });

  it("matches text found in a passed-in memory note", () => {
    expect(matchesQuery(song, "okinawa")).toBe(false); // not in any track field
    expect(matchesQuery(song, "okinawa", ["beach day in okinawa"])).toBe(true);
  });

  it("ANDs tokens across track fields and memory notes", () => {
    expect(matchesQuery(song, "drift okinawa", ["beach day in okinawa"])).toBe(true);
    expect(matchesQuery(song, "drift tokyo", ["beach day in okinawa"])).toBe(false);
  });

  it("still scopes #tag to tags, never memory notes", () => {
    expect(matchesQuery(song, "#beach", ["beach day in okinawa"])).toBe(false);
    expect(matchesQuery(song, "#chill", ["beach day in okinawa"])).toBe(true);
  });
});

describe("searchTracks", () => {
  it("filters the list by query", () => {
    const all = [neonRain, workout];
    expect(searchTracks(all, "road").map((t) => t.id)).toEqual(["a"]);
    expect(searchTracks(all, "").length).toBe(2);
  });

  it("joins per-track memory notes from the map when filtering", () => {
    const all = [neonRain, workout];
    const memories = new Map<string, string[]>([["b", ["leg day PR in osaka"]]]);
    expect(searchTracks(all, "osaka", memories).map((t) => t.id)).toEqual(["b"]);
    // without the memory map, "osaka" matches nothing
    expect(searchTracks(all, "osaka").length).toBe(0);
  });
});

describe("tracksWithTag", () => {
  it("returns tracks carrying an exact tag", () => {
    expect(tracksWithTag([neonRain, workout], "workout").map((t) => t.id)).toEqual(["b"]);
  });
});

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

describe("searchTracks", () => {
  it("filters the list by query", () => {
    const all = [neonRain, workout];
    expect(searchTracks(all, "road").map((t) => t.id)).toEqual(["a"]);
    expect(searchTracks(all, "").length).toBe(2);
  });
});

describe("tracksWithTag", () => {
  it("returns tracks carrying an exact tag", () => {
    expect(tracksWithTag([neonRain, workout], "workout").map((t) => t.id)).toEqual(["b"]);
  });
});

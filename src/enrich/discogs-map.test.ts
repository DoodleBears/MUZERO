import { describe, expect, it } from "vitest";
import { buildDiscogsSearchUrl, parseDiscogsSearch, toDiscogsHit } from "./discogs-map";

describe("buildDiscogsSearchUrl", () => {
  it("builds a release search with the primary artist + track + token", () => {
    const url = buildDiscogsSearchUrl(
      { trackName: "Yellow", artistName: "Coldplay feat. X" },
      "TOK",
    );
    expect(url).toContain("type=release");
    expect(url).toContain("token=TOK");
    expect(url).toContain("artist=Coldplay");
    expect(url).not.toContain("feat");
    expect(url).toContain("track=Yellow");
  });
});

describe("parseDiscogsSearch", () => {
  it("reads genre + style off the top result", () => {
    expect(
      parseDiscogsSearch({
        results: [
          { id: 1, genre: ["Electronic", "Pop"], style: ["House", "Deep House"] },
          { id: 2, genre: ["Rock"] },
        ],
      }),
    ).toEqual({ genres: ["Electronic", "Pop"], styles: ["House", "Deep House"] });
  });

  it("tolerates a missing/garbage body", () => {
    expect(parseDiscogsSearch({ results: [] })).toEqual({ genres: [], styles: [] });
    expect(parseDiscogsSearch(null)).toEqual({ genres: [], styles: [] });
  });
});

describe("toDiscogsHit", () => {
  it("normalizes genre→genres and style→styles", () => {
    const hit = toDiscogsHit({ genres: ["Electronic"], styles: ["Deep House", "House"] });
    expect(hit?.source).toBe("discogs");
    expect(hit?.genres).toEqual(["electronic"]);
    expect(hit?.styles).toEqual(["deep house", "house"]);
  });

  it("still returns a hit when only styles are present", () => {
    const hit = toDiscogsHit({ genres: [], styles: ["Synthwave"] });
    expect(hit?.genres).toEqual([]);
    expect(hit?.styles).toEqual(["synthwave"]);
  });

  it("returns null when neither genre nor style survives", () => {
    expect(toDiscogsHit({ genres: [], styles: [] })).toBeNull();
  });
});

import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";
import type { EnrichmentHit, MetadataEnrichmentProvider } from "./provider";
import { createAutoEnrichmentProvider, enrichmentProviderOrder } from "./registry";

function p(id: MetadataEnrichmentProvider["id"], result: EnrichmentHit | null | Error) {
  return {
    id,
    label: id,
    fetch: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  } satisfies MetadataEnrichmentProvider;
}
const hit = (source: EnrichmentHit["source"]): EnrichmentHit => ({ source, genres: ["pop"] });

describe("enrichmentProviderOrder", () => {
  it("is QQ (native, self-skips non-QQ) then MusicBrainz with no BYOK keys", () => {
    expect(enrichmentProviderOrder(DEFAULT_SETTINGS)).toEqual(["qq", "musicbrainz"]);
  });

  it("puts Last.fm ahead of the baseline when a key is set (per-track tags)", () => {
    expect(enrichmentProviderOrder({ ...DEFAULT_SETTINGS, lastfmApiKey: "k" })).toEqual([
      "qq",
      "lastfm",
      "musicbrainz",
    ]);
  });

  it("appends Discogs when a token is set", () => {
    expect(
      enrichmentProviderOrder({ ...DEFAULT_SETTINGS, lastfmApiKey: "k", discogsToken: "t" }),
    ).toEqual(["qq", "lastfm", "musicbrainz", "discogs"]);
  });
});

describe("createAutoEnrichmentProvider", () => {
  it("returns the first provider that yields a hit, skipping empties", async () => {
    const a = p("lastfm", null);
    const b = p("musicbrainz", hit("musicbrainz"));
    const c = p("discogs", hit("discogs"));
    const result = await createAutoEnrichmentProvider([a, b, c]).fetch({
      trackName: "t",
      artistName: "a",
    });
    expect(result?.source).toBe("musicbrainz");
    expect(c.fetch).not.toHaveBeenCalled(); // short-circuits after the first hit
  });

  it("skips a provider that throws and continues to the next", async () => {
    const result = await createAutoEnrichmentProvider([
      p("lastfm", new Error("network")),
      p("musicbrainz", hit("musicbrainz")),
    ]).fetch({ trackName: "t", artistName: "a" });
    expect(result?.source).toBe("musicbrainz");
  });

  it("returns null when every provider misses", async () => {
    const result = await createAutoEnrichmentProvider([
      p("lastfm", null),
      p("musicbrainz", null),
    ]).fetch({ trackName: "t", artistName: "a" });
    expect(result).toBeNull();
  });

  it("rethrows when every provider errored (a real failure, not a miss)", async () => {
    await expect(
      createAutoEnrichmentProvider([
        p("lastfm", new Error("a")),
        p("musicbrainz", new Error("b")),
      ]).fetch({ trackName: "t", artistName: "a" }),
    ).rejects.toThrow();
  });
});

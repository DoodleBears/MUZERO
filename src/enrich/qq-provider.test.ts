import { describe, expect, it, vi } from "vitest";
import type { EnrichmentQuery } from "./provider";
import { createQqEnrichmentProvider } from "./qq-provider";

const QQ_Q: EnrichmentQuery = {
  trackName: "稻香",
  artistName: "周杰伦",
  externalId: "mid1",
  streamSourceId: "qq",
};

describe("createQqEnrichmentProvider", () => {
  it("returns a native hit from QQ genre for a QQ track", async () => {
    const fetchNativeGenre = vi.fn(async () => ({ genres: ["Pop"], language: "国语" }));
    const hit = await createQqEnrichmentProvider({ fetchNativeGenre }).fetch(QQ_Q);
    expect(fetchNativeGenre).toHaveBeenCalledWith("mid1", undefined);
    expect(hit?.source).toBe("qq");
    expect(hit?.genres).toEqual(["pop"]); // normalized
    expect(hit?.match?.via).toBe("native");
  });

  it("self-skips non-QQ tracks (never mis-resolves a netease id as a QQ mid)", async () => {
    const fetchNativeGenre = vi.fn(async () => ({ genres: ["Pop"] }));
    const hit = await createQqEnrichmentProvider({ fetchNativeGenre }).fetch({
      ...QQ_Q,
      streamSourceId: "netease",
    });
    expect(hit).toBeNull();
    expect(fetchNativeGenre).not.toHaveBeenCalled();
  });

  it("skips when there is no externalId", async () => {
    const fetchNativeGenre = vi.fn(async () => ({ genres: ["Pop"] }));
    const hit = await createQqEnrichmentProvider({ fetchNativeGenre }).fetch({
      ...QQ_Q,
      externalId: undefined,
    });
    expect(hit).toBeNull();
    expect(fetchNativeGenre).not.toHaveBeenCalled();
  });

  it("returns null when QQ has no genre for the track", async () => {
    const hit = await createQqEnrichmentProvider({
      fetchNativeGenre: async () => ({ genres: [] }),
    }).fetch(QQ_Q);
    expect(hit).toBeNull();
  });
});

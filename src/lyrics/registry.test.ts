import { describe, expect, it, vi } from "vitest";
import type { LyricsHit, LyricsProvider, LyricsQuery } from "./provider";
import { createAutoLyricsProvider, LYRICS_PROVIDER_IDS } from "./registry";

const QUERY: LyricsQuery = {
  trackName: "Blue Highway",
  artistName: "Deidian",
  durationSec: 214,
};

const HIT: LyricsHit = {
  source: "netease",
  sourceId: "42",
  synced: "[00:01.00]x",
  instrumental: false,
  matched: { trackName: "Blue Highway", artistName: "Deidian", durationSec: 214 },
};

function provider(
  id: LyricsProvider["id"],
  fetchResult: LyricsHit | null | Error,
  searchResult?: LyricsHit[] | Error,
): LyricsProvider {
  return {
    id,
    label: id,
    fetch: vi.fn(async () => {
      if (fetchResult instanceof Error) throw fetchResult;
      return fetchResult;
    }),
    search:
      searchResult === undefined
        ? undefined
        : vi.fn(async () => {
            if (searchResult instanceof Error) throw searchResult;
            return searchResult;
          }),
  };
}

describe("lyrics registry", () => {
  it("offers auto as the first selectable provider", () => {
    expect(LYRICS_PROVIDER_IDS[0]).toBe("auto");
  });

  it("auto fetch tries the next provider after a miss", async () => {
    const first = provider("lrclib", null);
    const second = provider("netease", HIT);
    const auto = createAutoLyricsProvider(() => [first, second]);

    await expect(auto.fetch(QUERY)).resolves.toBe(HIT);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).toHaveBeenCalledTimes(1);
  });

  it("auto fetch tries the next provider after an error", async () => {
    const first = provider("lrclib", new Error("down"));
    const second = provider("netease", HIT);
    const auto = createAutoLyricsProvider(() => [first, second]);

    await expect(auto.fetch(QUERY)).resolves.toBe(HIT);
  });

  it("auto fetch short-circuits on a high-confidence hit (skips later providers)", async () => {
    const first = provider("lrclib", HIT); // exact title/artist/duration → high confidence
    const second = provider("netease", HIT);
    const auto = createAutoLyricsProvider(() => [first, second]);

    await expect(auto.fetch(QUERY)).resolves.toBe(HIT);
    expect(first.fetch).toHaveBeenCalledTimes(1);
    expect(second.fetch).not.toHaveBeenCalled();
  });

  it("auto fetch prefers a word-level hit over a line-level one when neither is authoritative", async () => {
    const q: LyricsQuery = { trackName: "Song", artistName: "A", durationSec: 200 };
    // Both ~12s off → confidence below the short-circuit threshold → both gathered.
    const line: LyricsHit = {
      source: "lrclib",
      sourceId: "L",
      synced: "[00:01.00]x",
      format: "lrc",
      instrumental: false,
      matched: { trackName: "Song", artistName: "A", durationSec: 212 },
    };
    const word: LyricsHit = {
      source: "netease",
      sourceId: "W",
      synced: "[00:01.000](0,1,0)x",
      format: "yrc",
      instrumental: false,
      matched: { trackName: "Song", artistName: "A", durationSec: 212 },
    };
    const auto = createAutoLyricsProvider(() => [
      provider("lrclib", line),
      provider("netease", word),
    ]);

    expect((await auto.fetch(q))?.sourceId).toBe("W");
  });

  it("auto search merges unique hits from available providers", async () => {
    const first = provider("lrclib", null, [HIT]);
    const second = provider("netease", null, [HIT]);
    const auto = createAutoLyricsProvider(() => [first, second]);

    await expect(auto.search?.(QUERY)).resolves.toEqual([HIT]);
  });
});

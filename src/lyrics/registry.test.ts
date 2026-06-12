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

  it("auto search merges unique hits from available providers", async () => {
    const first = provider("lrclib", null, [HIT]);
    const second = provider("netease", null, [HIT]);
    const auto = createAutoLyricsProvider(() => [first, second]);

    await expect(auto.search?.(QUERY)).resolves.toEqual([HIT]);
  });
});

import { describe, expect, it } from "vitest";
import {
  MATCH_GATE,
  normalizeTitle,
  passesGate,
  primaryArtist,
  scoreCandidate,
  titleSimilarity,
} from "./match-text";
import type { LyricsHit, LyricsQuery } from "./provider";

describe("normalizeTitle", () => {
  it("strips a trailing version parenthetical", () => {
    expect(normalizeTitle("Song (Live)")).toBe("Song");
    expect(normalizeTitle("Song (Remastered 2011)")).toBe("Song");
    expect(normalizeTitle("Song (Acoustic)")).toBe("Song");
    expect(normalizeTitle("Song [Instrumental]")).toBe("Song");
  });

  it("strips a trailing feat parenthetical", () => {
    expect(normalizeTitle("Song (feat. B)")).toBe("Song");
    expect(normalizeTitle("Song (ft. B & C)")).toBe("Song");
  });

  it("strips a dash version suffix", () => {
    expect(normalizeTitle("Song - Remastered")).toBe("Song");
    expect(normalizeTitle("Song - 2011 Remaster")).toBe("Song");
    expect(normalizeTitle("Song - Live at Wembley")).toBe("Song");
  });

  it("strips an inline feat suffix", () => {
    expect(normalizeTitle("Song feat. B")).toBe("Song");
    expect(normalizeTitle("Song featuring B and C")).toBe("Song");
  });

  it("normalizes full-width brackets and CJK version words", () => {
    expect(normalizeTitle("歌名（伴奏）")).toBe("歌名");
    expect(normalizeTitle("歌名（现场版）")).toBe("歌名");
  });

  it("does NOT strip a leading/non-version parenthetical", () => {
    expect(normalizeTitle("(Don't Fear) The Reaper")).toBe("(Don't Fear) The Reaper");
    expect(normalizeTitle("Song (Part 1)")).toBe("Song (Part 1)");
  });

  it("collapses whitespace and trims, preserving case", () => {
    expect(normalizeTitle("  Hello   World  ")).toBe("Hello World");
    expect(normalizeTitle("MixedCase Title")).toBe("MixedCase Title");
  });

  it("peels multiple trailing version groups", () => {
    expect(normalizeTitle("Song (Remastered) [Live]")).toBe("Song");
  });
});

describe("primaryArtist", () => {
  it("returns the first artist of a comma list", () => {
    expect(primaryArtist("A, B, C")).toBe("A");
    expect(primaryArtist("A，B")).toBe("A");
  });

  it("splits on collab separators", () => {
    expect(primaryArtist("A & B")).toBe("A");
    expect(primaryArtist("A feat. B")).toBe("A");
    expect(primaryArtist("A ft. B")).toBe("A");
    expect(primaryArtist("A 与 B")).toBe("A");
    expect(primaryArtist("A、B")).toBe("A");
  });

  it("does not split inside a single name", () => {
    expect(primaryArtist("Charli XCX")).toBe("Charli XCX");
    expect(primaryArtist("Maximo")).toBe("Maximo");
  });

  it("trims the result", () => {
    expect(primaryArtist("  Solo Artist  ")).toBe("Solo Artist");
  });
});

describe("titleSimilarity", () => {
  it("is 1 for identical titles ignoring case/space", () => {
    expect(titleSimilarity("Hello World", "hello world")).toBe(1);
    expect(titleSimilarity(" Hey ", "hey")).toBe(1);
  });

  it("is ~0 for completely different titles", () => {
    expect(titleSimilarity("Apple", "Zebra Mountain")).toBeLessThan(0.3);
  });

  it("is high for token-reordered titles", () => {
    expect(titleSimilarity("World Hello", "Hello World")).toBeGreaterThan(0.8);
  });

  it("is high for a small typo", () => {
    expect(titleSimilarity("Yesterday", "Yesteday")).toBeGreaterThan(0.8);
  });
});

const QUERY: LyricsQuery = {
  trackName: "I Want to Live",
  artistName: "Borislav Slavov",
  durationSec: 233,
};

function hit(over: Partial<LyricsHit> = {}): LyricsHit {
  return {
    source: "lrclib",
    synced: "[00:17.12] line",
    instrumental: false,
    matched: { trackName: "I Want to Live", artistName: "Borislav Slavov", durationSec: 233 },
    ...over,
  };
}

describe("scoreCandidate", () => {
  it("ranks word-synced above line-synced above plain", () => {
    const word = scoreCandidate(hit({ format: "yrc" }), QUERY).confidence;
    const line = scoreCandidate(hit({ format: "lrc" }), QUERY).confidence;
    const plain = scoreCandidate(hit({ synced: undefined, plain: "text" }), QUERY).confidence;
    expect(word).toBeGreaterThan(line);
    expect(line).toBeGreaterThan(plain);
  });

  it("reports the duration delta and penalizes a far one", () => {
    const near = scoreCandidate(hit(), QUERY);
    const far = scoreCandidate(
      hit({ matched: { trackName: "I Want to Live", artistName: "x", durationSec: 280 } }),
      QUERY,
    );
    expect(near.durationDelta).toBe(0);
    expect(far.durationDelta).toBe(47);
    expect(near.confidence).toBeGreaterThan(far.confidence);
  });

  it("uses a neutral duration score when the query has no duration", () => {
    const { durationDelta } = scoreCandidate(hit(), { ...QUERY, durationSec: undefined });
    expect(durationDelta).toBeUndefined();
  });

  it("reports a low title similarity for a different song", () => {
    const s = scoreCandidate(
      hit({ matched: { trackName: "Totally Other Song", artistName: "x", durationSec: 233 } }),
      QUERY,
    );
    expect(s.titleSim).toBeLessThan(0.5);
  });
});

describe("passesGate", () => {
  it("accepts a strong match at the default level", () => {
    expect(passesGate(scoreCandidate(hit(), QUERY), "exact")).toBe(true);
  });

  it("rejects a candidate whose duration is beyond the hard threshold", () => {
    const far = scoreCandidate(
      hit({ matched: { trackName: "I Want to Live", artistName: "x", durationSec: 233 + 25 } }),
      QUERY,
    );
    expect(far.durationDelta).toBeGreaterThan(MATCH_GATE.durationHardSec);
    expect(passesGate(far, "noAlbum")).toBe(false);
  });

  it("requires a high title similarity for the titleOnly level", () => {
    const wrongSong = scoreCandidate(
      hit({ matched: { trackName: "Totally Other Song", artistName: "x", durationSec: 233 } }),
      QUERY,
    );
    // duration matches, but the title does not — must be rejected at titleOnly.
    expect(passesGate(wrongSong, "titleOnly")).toBe(false);
    const rightSong = scoreCandidate(hit(), QUERY);
    expect(passesGate(rightSong, "titleOnly")).toBe(true);
  });
});

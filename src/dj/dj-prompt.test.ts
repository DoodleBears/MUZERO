import { describe, expect, it } from "vitest";
import { buildDjUserPrompt, type DjContext } from "./dj-prompt";

function context(overrides: Partial<DjContext>): DjContext {
  return {
    seedPrompt: "late beach set",
    config: {
      allowVocals: true,
      targetDurationSec: 120,
      batchSize: 1,
      refillThreshold: 1,
      autoExtend: true,
    },
    recent: [],
    count: 1,
    ...overrides,
  };
}

describe("buildDjUserPrompt", () => {
  it("includes imported media metadata in the recent track context", () => {
    const prompt = buildDjUserPrompt(
      context({
        recent: [
          {
            title: "Moonstone Beach",
            caption: "uploaded audio",
            metadata: {
              artists: ["Deidian"],
              album: "Soluna",
              genres: ["organic house", "chill"],
              year: 2026,
            },
          },
        ],
      }),
    );

    expect(prompt).toContain("artist: Deidian");
    expect(prompt).toContain("album: Soluna");
    expect(prompt).toContain("genres: organic house, chill");
    expect(prompt).toContain("year: 2026");
  });
});

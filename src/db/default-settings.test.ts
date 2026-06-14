import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";

describe("DEFAULT_SETTINGS", () => {
  it("enables streamed offline cache by default", () => {
    expect(DEFAULT_SETTINGS.autoCacheStreamed).toBe(true);
  });

  it("uses the theme default lyric text color by default", () => {
    expect(DEFAULT_SETTINGS.lyricsColorMode).toBe("default");
  });
});

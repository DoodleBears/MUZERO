import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";

describe("DEFAULT_SETTINGS", () => {
  it("enables streamed offline cache by default", () => {
    expect(DEFAULT_SETTINGS.autoCacheStreamed).toBe(true);
  });

  it("uses the theme default lyric text color by default", () => {
    expect(DEFAULT_SETTINGS.lyricsColorMode).toBe("default");
  });

  it("keeps live chat request intake off by default", () => {
    expect(DEFAULT_SETTINGS.audienceRequestIntake).toMatchObject({
      enabled: false,
      bindHost: "127.0.0.1",
      port: 41731,
      routeMode: "library-search",
      playbackAction: "play-next",
      searchScope: "all-library",
      onlineFallbackOnLowConfidence: true,
      requireApprovalForPlayNow: true,
    });
  });
});

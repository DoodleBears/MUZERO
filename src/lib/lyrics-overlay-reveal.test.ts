import { describe, expect, it } from "vitest";
import { resolveLyricsOverlayRevealed } from "./lyrics-overlay-reveal";

describe("resolveLyricsOverlayRevealed", () => {
  it("locked: reveals ONLY when the cursor is over the control-bar region", () => {
    expect(
      resolveLyricsOverlayRevealed({ locked: true, idle: false, clickThroughHover: false }),
    ).toBe(false);
    expect(
      resolveLyricsOverlayRevealed({ locked: true, idle: true, clickThroughHover: false }),
    ).toBe(false);
    expect(
      resolveLyricsOverlayRevealed({ locked: true, idle: false, clickThroughHover: true }),
    ).toBe(true);
    expect(
      resolveLyricsOverlayRevealed({ locked: true, idle: true, clickThroughHover: true }),
    ).toBe(true);
  });

  it("locked: global pointer activity (not idle) must NOT reveal the bar", () => {
    // The reported bug: moving/clicking NEAR the lyrics flashed the bar's
    // translucent background, so the capture stopped being fully transparent.
    expect(
      resolveLyricsOverlayRevealed({ locked: true, idle: false, clickThroughHover: false }),
    ).toBe(false);
  });

  it("pinned (not locked): reveals on pointer activity OR region hover", () => {
    expect(
      resolveLyricsOverlayRevealed({ locked: false, idle: false, clickThroughHover: false }),
    ).toBe(true);
    expect(
      resolveLyricsOverlayRevealed({ locked: false, idle: true, clickThroughHover: false }),
    ).toBe(false);
    expect(
      resolveLyricsOverlayRevealed({ locked: false, idle: true, clickThroughHover: true }),
    ).toBe(true);
  });
});

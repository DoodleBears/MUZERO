import { describe, expect, it } from "vitest";
import { resolveAmbientEffectsImmersive } from "./ambient-effects-immersive";

describe("resolveAmbientEffectsImmersive", () => {
  it("exits immersive effects when idle chrome has recovered", () => {
    expect(
      resolveAmbientEffectsImmersive({
        chromeHidden: false,
        isNowTab: true,
        lyricsOnlyIdle: false,
        visualizerIdleOnly: false,
      }),
    ).toBe(false);
  });

  it("keeps immersive effects while chrome or idle-only modes are active", () => {
    expect(
      resolveAmbientEffectsImmersive({
        chromeHidden: true,
        isNowTab: true,
        lyricsOnlyIdle: false,
        visualizerIdleOnly: false,
      }),
    ).toBe(true);
    expect(
      resolveAmbientEffectsImmersive({
        chromeHidden: false,
        isNowTab: true,
        lyricsOnlyIdle: false,
        visualizerIdleOnly: true,
      }),
    ).toBe(true);
    expect(
      resolveAmbientEffectsImmersive({
        chromeHidden: false,
        isNowTab: true,
        lyricsOnlyIdle: true,
        visualizerIdleOnly: false,
      }),
    ).toBe(true);
  });

  it("does not keep effects immersive outside Now Playing", () => {
    expect(
      resolveAmbientEffectsImmersive({
        chromeHidden: true,
        isNowTab: false,
        lyricsOnlyIdle: true,
        visualizerIdleOnly: true,
      }),
    ).toBe(false);
  });
});

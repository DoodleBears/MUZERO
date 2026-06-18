import { describe, expect, it } from "vitest";
import { resolveAmbientEffectsImmersive } from "./ambient-effects-immersive";

describe("resolveAmbientEffectsImmersive", () => {
  it("exits immersive effects when idle chrome has recovered", () => {
    expect(
      resolveAmbientEffectsImmersive({
        isNowTab: true,
        visualizerIdleOnly: false,
      }),
    ).toBe(false);
  });

  it("does not use immersive effect settings for ordinary chrome idle", () => {
    expect(
      resolveAmbientEffectsImmersive({
        isNowTab: true,
        visualizerIdleOnly: false,
      }),
    ).toBe(false);
  });

  it("keeps immersive effects while explicit immersive visualizer mode is active", () => {
    expect(
      resolveAmbientEffectsImmersive({
        isNowTab: true,
        visualizerIdleOnly: true,
      }),
    ).toBe(true);
  });

  it("does not keep effects immersive outside Now Playing", () => {
    expect(
      resolveAmbientEffectsImmersive({
        isNowTab: false,
        visualizerIdleOnly: true,
      }),
    ).toBe(false);
  });
});

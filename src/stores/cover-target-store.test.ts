import { afterEach, describe, expect, it } from "vitest";
import { useCoverTargetStore } from "./cover-target-store";

afterEach(() => useCoverTargetStore.getState().setCoverTarget(null));

describe("cover-target-store", () => {
  it("defaults to no target", () => {
    expect(useCoverTargetStore.getState().trackId).toBeNull();
  });

  it("publishes and clears the selected track id", () => {
    useCoverTargetStore.getState().setCoverTarget("trk_42");
    expect(useCoverTargetStore.getState().trackId).toBe("trk_42");

    useCoverTargetStore.getState().setCoverTarget(null);
    expect(useCoverTargetStore.getState().trackId).toBeNull();
  });
});

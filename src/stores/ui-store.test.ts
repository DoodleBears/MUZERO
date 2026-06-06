import { afterEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui-store";

afterEach(() => useUiStore.setState({ isSheetOpen: false }));

describe("ui-store — Now Playing sheet", () => {
  it("starts closed", () => {
    expect(useUiStore.getState().isSheetOpen).toBe(false);
  });

  it("openSheet / closeSheet toggle the flag", () => {
    useUiStore.getState().openSheet();
    expect(useUiStore.getState().isSheetOpen).toBe(true);
    useUiStore.getState().closeSheet();
    expect(useUiStore.getState().isSheetOpen).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./ui-store";

describe("ui-store", () => {
  beforeEach(() => useUiStore.setState({ queueOpen: false }));

  it("opens and closes the queue drawer", () => {
    useUiStore.getState().setQueueOpen(true);
    expect(useUiStore.getState().queueOpen).toBe(true);
    useUiStore.getState().setQueueOpen(false);
    expect(useUiStore.getState().queueOpen).toBe(false);
  });

  it("toggles the queue drawer", () => {
    useUiStore.getState().toggleQueue();
    expect(useUiStore.getState().queueOpen).toBe(true);
    useUiStore.getState().toggleQueue();
    expect(useUiStore.getState().queueOpen).toBe(false);
  });

  it("mirrors the chrome-hidden signal idempotently", () => {
    const before = useUiStore.getState();
    expect(before.chromeHidden).toBe(false);
    before.setChromeHidden(false); // no-op keeps the same state object
    expect(useUiStore.getState()).toBe(before);
    before.setChromeHidden(true);
    expect(useUiStore.getState().chromeHidden).toBe(true);
  });
});

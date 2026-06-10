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
});

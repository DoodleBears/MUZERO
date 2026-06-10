import { describe, expect, it } from "vitest";
import { resolveDropTarget } from "./reorder-drop";

// orderedIds is the set's current DISPLAY order; the result feeds
// reorderTracksInSession(setId, blockIds, insertBeforeId).
describe("resolveDropTarget", () => {
  const order = ["a", "b", "c", "d", "e"];

  it("single row dragged down lands after the drop target", () => {
    // Drag a onto b → a should sit right after b (before c).
    expect(resolveDropTarget(order, ["a"], "a", "b")).toEqual({ insertBeforeId: "c" });
  });

  it("single row dragged to the last slot lands at the end", () => {
    expect(resolveDropTarget(order, ["a"], "a", "e")).toEqual({ insertBeforeId: null });
  });

  it("single row dragged up lands before the drop target", () => {
    // Drag d onto b → d before b.
    expect(resolveDropTarget(order, ["d"], "d", "b")).toEqual({ insertBeforeId: "b" });
  });

  it("a multi-select block keeps relative order and lands where active rests", () => {
    // Selection {a, c}, drag a onto d (downward) → block lands after d, before e.
    expect(resolveDropTarget(order, ["a", "c"], "a", "d")).toEqual({ insertBeforeId: "e" });
  });

  it("block skips its own members when finding the anchor", () => {
    // Selection {a, c}, drag a onto b → next non-block after a's new slot is d (c is skipped).
    expect(resolveDropTarget(order, ["a", "c"], "a", "b")).toEqual({ insertBeforeId: "d" });
  });

  it("dropping on itself yields the current following id (planReorder treats it as a no-op)", () => {
    expect(resolveDropTarget(order, ["a"], "a", "a")).toEqual({ insertBeforeId: "b" });
  });

  it("returns null when active or over is unknown (defensive)", () => {
    expect(resolveDropTarget(order, ["a"], "a", "zzz")).toEqual({ insertBeforeId: null });
    expect(resolveDropTarget(order, ["zzz"], "zzz", "b")).toEqual({ insertBeforeId: null });
  });
});

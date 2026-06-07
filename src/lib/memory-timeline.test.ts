import { describe, expect, it } from "vitest";
import {
  memoryTimelineIndexFromScroll,
  nextIdleMemoryIndex,
  sortMemoryTimelineItems,
} from "./memory-timeline";

describe("memory timeline logic", () => {
  it("sorts memories oldest first while keeping stable order for ties", () => {
    const items = [
      { id: "late", createdAt: 30 },
      { id: "tie-a", createdAt: 10 },
      { id: "middle", createdAt: 20 },
      { id: "tie-b", createdAt: 10 },
    ];

    expect(sortMemoryTimelineItems(items).map((item) => item.id)).toEqual([
      "tie-a",
      "tie-b",
      "middle",
      "late",
    ]);
  });

  it("anchors a persisted scrollTop to the nearest timeline item", () => {
    expect(memoryTimelineIndexFromScroll(0, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromScroll(95, 96, 4)).toBe(1);
    expect(memoryTimelineIndexFromScroll(240, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromScroll(999, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromScroll(-10, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromScroll(120, 0, 4)).toBe(0);
    expect(memoryTimelineIndexFromScroll(120, 96, 0)).toBe(0);
  });

  it("wraps idle carousel indices from the current anchor", () => {
    expect(nextIdleMemoryIndex(0, 3)).toBe(1);
    expect(nextIdleMemoryIndex(2, 3)).toBe(0);
    expect(nextIdleMemoryIndex(10, 3)).toBe(0);
    expect(nextIdleMemoryIndex(0, 0)).toBe(0);
  });
});

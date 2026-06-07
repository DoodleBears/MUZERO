import { describe, expect, it } from "vitest";
import {
  memoryTimelineIndexFromOffset,
  memoryTimelineOffsetForIndex,
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

  it("anchors a persisted timeline offset to the nearest item under the playhead", () => {
    expect(memoryTimelineIndexFromOffset(0, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(95, 96, 4)).toBe(1);
    expect(memoryTimelineIndexFromOffset(240, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromOffset(999, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromOffset(-10, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(120, 0, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(120, 96, 0)).toBe(0);
  });

  it("maps an item index back to a draggable timeline offset", () => {
    expect(memoryTimelineOffsetForIndex(0, 96, 4)).toBe(0);
    expect(memoryTimelineOffsetForIndex(2, 96, 4)).toBe(192);
    expect(memoryTimelineOffsetForIndex(99, 96, 4)).toBe(288);
    expect(memoryTimelineOffsetForIndex(-2, 96, 4)).toBe(0);
    expect(memoryTimelineOffsetForIndex(1, 0, 4)).toBe(0);
    expect(memoryTimelineOffsetForIndex(1, 96, 0)).toBe(0);
  });

  it("wraps idle carousel indices from the current anchor", () => {
    expect(nextIdleMemoryIndex(0, 3)).toBe(1);
    expect(nextIdleMemoryIndex(2, 3)).toBe(0);
    expect(nextIdleMemoryIndex(10, 3)).toBe(0);
    expect(nextIdleMemoryIndex(0, 0)).toBe(0);
  });
});

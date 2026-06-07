import { describe, expect, it } from "vitest";
import {
  layoutMemoryTimelineItems,
  memoryTimelineCarouselIntervalMs,
  memoryTimelineIndexFromLayoutOffset,
  memoryTimelineIndexFromOffset,
  memoryTimelineOffsetForIndex,
  memoryTimelineOffsetForLayoutIndex,
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

  it("anchors a persisted vertical timeline offset to the nearest item under the playhead", () => {
    expect(memoryTimelineIndexFromOffset(0, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(95, 96, 4)).toBe(1);
    expect(memoryTimelineIndexFromOffset(240, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromOffset(999, 96, 4)).toBe(3);
    expect(memoryTimelineIndexFromOffset(-10, 96, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(120, 0, 4)).toBe(0);
    expect(memoryTimelineIndexFromOffset(120, 96, 0)).toBe(0);
  });

  it("maps an item index back to a draggable vertical timeline offset", () => {
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

  it("extends idle carousel dwell time for longer memory notes with a cap", () => {
    const options = {
      baseMs: 1000,
      extraStartCharCount: 10,
      maxMs: 3600,
      msPerCharacter: 100,
    };

    expect(memoryTimelineCarouselIntervalMs("short", options)).toBe(1000);
    expect(memoryTimelineCarouselIntervalMs("x".repeat(20), options)).toBe(2000);
    expect(memoryTimelineCarouselIntervalMs("x".repeat(100), options)).toBe(3600);
  });

  it("lays out memory timeline items as one responsive column with variable heights", () => {
    const layout = layoutMemoryTimelineItems(
      [
        { id: "short", note: "short note" },
        { hasPhoto: true, id: "long", note: "long note ".repeat(20) },
        { id: "next", note: "next" },
      ],
      {
        baseItemHeight: 100,
        gap: 12,
        width: 360,
      },
      (text) => (text.includes("long") ? 160 : 24),
    );

    expect(layout.items[0]).toMatchObject({ height: 100, id: "short", y: 0 });
    expect(layout.items[1].height).toBeGreaterThan(100);
    expect(layout.items[1].y).toBe(112);
    expect(layout.items[2].y).toBe(layout.items[1].y + layout.items[1].height + 12);
    expect(layout.containerHeight).toBe(layout.items[2].y + layout.items[2].height);
  });

  it("maps variable timeline offsets to the nearest responsive item", () => {
    const layout = {
      containerHeight: 372,
      items: [
        { height: 100, id: "a", y: 0 },
        { height: 180, id: "b", y: 112 },
        { height: 80, id: "c", y: 304 },
      ],
    };

    expect(memoryTimelineIndexFromLayoutOffset(0, layout.items)).toBe(0);
    expect(memoryTimelineIndexFromLayoutOffset(120, layout.items)).toBe(1);
    expect(memoryTimelineIndexFromLayoutOffset(305, layout.items)).toBe(2);
    expect(memoryTimelineOffsetForLayoutIndex(1, layout.items)).toBe(112);
    expect(memoryTimelineOffsetForLayoutIndex(10, layout.items)).toBe(304);
  });
});

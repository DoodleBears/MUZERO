import { describe, expect, it, vi } from "vitest";
import {
  layoutMemoryMasonry,
  MEMORY_MASONRY_LEADING_ID,
  memoryMasonryDefaults,
  resolveMemoryMasonryColumnCount,
} from "./memory-masonry";

const options = {
  ...memoryMasonryDefaults,
  containerWidth: 612,
  maxColumnCount: 2,
  minColumnWidth: 300,
};

describe("memory masonry layout", () => {
  it("top-aligns the create tile and the first memory card in the first row", () => {
    const layout = layoutMemoryMasonry(
      [
        { fixedHeight: 128, id: MEMORY_MASONRY_LEADING_ID },
        { id: "mem_a", note: "first memory" },
        { id: "mem_b", note: "second memory" },
      ],
      options,
      () => 24,
    );

    expect(layout.columnCount).toBe(2);
    expect(layout.items[0]).toMatchObject({ column: 0, id: MEMORY_MASONRY_LEADING_ID, y: 0 });
    expect(layout.items[1]).toMatchObject({ column: 1, id: "mem_a", y: 0 });
    expect(layout.items[2]?.y).toBeGreaterThan(0);
  });

  it("uses measured text height when choosing the next shortest column", () => {
    const measure = vi.fn((text: string) => (text.includes("long") ? 160 : 24));
    const layout = layoutMemoryMasonry(
      [
        { id: "mem_long", note: "long memory" },
        { id: "mem_short", note: "short" },
        { id: "mem_next", note: "next" },
      ],
      options,
      measure,
    );

    expect(measure).toHaveBeenCalledWith("long memory", 276, options.noteFont, 24);
    expect(layout.items[0]).toMatchObject({ column: 0, id: "mem_long", y: 0 });
    expect(layout.items[1]).toMatchObject({ column: 1, id: "mem_short", y: 0 });
    expect(layout.items[2]).toMatchObject({ column: 1, id: "mem_next" });
  });

  it("uses each photo natural height ratio when estimating card height", () => {
    const layout = layoutMemoryMasonry(
      [{ hasPhoto: true, id: "mem_portrait", note: "portrait", photoHeightRatio: 2 }],
      {
        ...memoryMasonryDefaults,
        containerWidth: 300,
        maxColumnCount: 1,
      },
      () => 24,
    );

    expect(layout.items[0]).toMatchObject({
      height: 652,
      id: "mem_portrait",
      width: 300,
    });
  });

  it("resolves responsive column counts from available width", () => {
    expect(resolveMemoryMasonryColumnCount(260, 280, 3, 12)).toBe(1);
    expect(resolveMemoryMasonryColumnCount(612, 280, 3, 12)).toBe(2);
    expect(resolveMemoryMasonryColumnCount(960, 280, 3, 12)).toBe(3);
  });

  it("keeps a single column within narrow containers", () => {
    const layout = layoutMemoryMasonry(
      [{ id: "mem_narrow", note: "mobile width" }],
      {
        ...memoryMasonryDefaults,
        containerWidth: 240,
      },
      () => 24,
    );

    expect(layout.columnCount).toBe(1);
    expect(layout.columnWidth).toBe(240);
    expect(layout.items[0]).toMatchObject({ width: 240, x: 0 });
  });
});

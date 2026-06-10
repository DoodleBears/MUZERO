import { describe, expect, it } from "vitest";
import { galleryColumns, galleryRowCount, galleryRowEstimate } from "./gallery-grid";

describe("galleryColumns", () => {
  it("is always one column in list view", () => {
    for (const w of [320, 640, 1024, 1920]) {
      expect(galleryColumns(w, "list")).toBe(1);
    }
  });

  it("mirrors the grid-cols-2 / sm:3 / lg:4 breakpoints", () => {
    expect(galleryColumns(375, "grid")).toBe(2); // < sm
    expect(galleryColumns(639, "grid")).toBe(2); // just below sm
    expect(galleryColumns(640, "grid")).toBe(3); // sm
    expect(galleryColumns(1023, "grid")).toBe(3); // just below lg
    expect(galleryColumns(1024, "grid")).toBe(4); // lg
    expect(galleryColumns(2560, "grid")).toBe(4);
  });
});

describe("galleryRowCount", () => {
  it("chunks items into rows, rounding up the last partial row", () => {
    expect(galleryRowCount(0, 4)).toBe(0);
    expect(galleryRowCount(1, 4)).toBe(1);
    expect(galleryRowCount(4, 4)).toBe(1);
    expect(galleryRowCount(5, 4)).toBe(2);
    expect(galleryRowCount(9, 3)).toBe(3);
  });

  it("guards against zero/negative columns or counts", () => {
    expect(galleryRowCount(10, 0)).toBe(0);
    expect(galleryRowCount(-3, 4)).toBe(0);
  });
});

describe("galleryRowEstimate", () => {
  const base = { contentWidth: 900, columns: 3, gap: 12, captionHeight: 46, listRowHeight: 60 };

  it("returns the fixed list row height in list view", () => {
    expect(galleryRowEstimate("list", base)).toBe(60);
  });

  it("estimates grid rows from the square cover width plus caption and gap", () => {
    // cardWidth = (900 - 12*2)/3 = 292; estimate = round(292 + 46 + 12) = 350
    expect(galleryRowEstimate("grid", base)).toBe(350);
  });

  it("falls back to the list height when width is unknown", () => {
    expect(galleryRowEstimate("grid", { ...base, contentWidth: 0 })).toBe(60);
  });
});

import { describe, expect, it } from "vitest";
import { trackIndexFromEventTarget } from "./track-row-target";

/** Build a row element (carrying `data-track-index`) with a nested child. */
function rowWithChild(index: number): { row: HTMLElement; child: HTMLElement } {
  const row = document.createElement("div");
  row.setAttribute("data-track-index", String(index));
  const child = document.createElement("span");
  row.appendChild(child);
  document.body.appendChild(row);
  return { row, child };
}

describe("trackIndexFromEventTarget", () => {
  it("resolves the index from a row or any descendant of it", () => {
    const { row, child } = rowWithChild(2);
    expect(trackIndexFromEventTarget(row, 5)).toBe(2);
    expect(trackIndexFromEventTarget(child, 5)).toBe(2);
  });

  it("returns null when the target is outside any row", () => {
    const loose = document.createElement("div");
    document.body.appendChild(loose);
    expect(trackIndexFromEventTarget(loose, 5)).toBeNull();
  });

  it("returns null for an out-of-range or non-integer index (defensive)", () => {
    const { row } = rowWithChild(9);
    expect(trackIndexFromEventTarget(row, 5)).toBeNull(); // 9 >= count 5
    const bad = document.createElement("div");
    bad.setAttribute("data-track-index", "nope");
    document.body.appendChild(bad);
    expect(trackIndexFromEventTarget(bad, 5)).toBeNull();
  });

  it("returns null for a null / non-element target", () => {
    expect(trackIndexFromEventTarget(null, 5)).toBeNull();
  });
});

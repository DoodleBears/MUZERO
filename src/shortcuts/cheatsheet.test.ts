import { describe, expect, it } from "vitest";
import { buildCheatSheet, CHEAT_SHEET_CATEGORY_ORDER, cheatSheetRowMatches } from "./cheatsheet";
import { mergeBindings } from "./engine";
import { SHORTCUT_ACTIONS } from "./registry";

const bindings = mergeBindings();

describe("buildCheatSheet", () => {
  const sections = buildCheatSheet(bindings, "other");

  it("groups every action exactly once, in category order", () => {
    const order = sections.map((s) => s.category);
    expect(order).toEqual(CHEAT_SHEET_CATEGORY_ORDER.filter((c) => order.includes(c)));
    const rowCount = sections.reduce((n, s) => n + s.rows.length, 0);
    expect(rowCount).toBe(SHORTCUT_ACTIONS.length);
  });

  it("renders chips for a configurable action and marks it editable", () => {
    const prev = sections.flatMap((s) => s.rows).find((r) => r.actionId === "playback.prev");
    expect(prev?.editable).toBe(true);
    expect(prev?.chips).toEqual([["Q"]]);
  });

  it("surfaces reference rows as non-editable with gesture labels", () => {
    const ref = sections.find((s) => s.category === "reference");
    expect(ref).toBeTruthy();
    const swipe = ref?.rows.find((r) => r.actionId === "ref.swipeBack");
    expect(swipe?.editable).toBe(false);
    expect(swipe?.chips).toEqual([]); // pointer gesture → no key chips
    expect(swipe?.gestureLabelKeys).toEqual(["shortcuts.gesture.swipeBack"]);
  });
});

describe("cheatSheetRowMatches", () => {
  const row = buildCheatSheet(bindings, "other")
    .flatMap((s) => s.rows)
    .find((r) => r.actionId === "playback.prev")!;

  it("matches everything on an empty query", () => {
    expect(cheatSheetRowMatches(row, "", "Previous track")).toBe(true);
  });

  it("matches the localized label, the keyword, the id, and chord text", () => {
    expect(cheatSheetRowMatches(row, "previous", "Previous track")).toBe(true);
    expect(cheatSheetRowMatches(row, "上一首", "上一首")).toBe(true); // keyword
    expect(cheatSheetRowMatches(row, "playback.prev", "Previous track")).toBe(true);
    expect(cheatSheetRowMatches(row, "q", "Previous track")).toBe(true); // chord
    expect(cheatSheetRowMatches(row, "zzz", "Previous track")).toBe(false);
  });
});

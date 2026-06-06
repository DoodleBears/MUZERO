import { describe, expect, it } from "vitest";
import { modifierSymbol, SHORTCUT_TABS, tabForShortcutKey } from "./shortcuts";

describe("tabForShortcutKey", () => {
  it("maps digits 1–4 to the nav tabs in order", () => {
    expect(tabForShortcutKey("1")).toBe("queue");
    expect(tabForShortcutKey("2")).toBe("search");
    expect(tabForShortcutKey("3")).toBe("sessions");
    expect(tabForShortcutKey("4")).toBe("settings");
  });

  it("returns null for out-of-range or non-digit keys", () => {
    expect(tabForShortcutKey("0")).toBeNull();
    expect(tabForShortcutKey("5")).toBeNull();
    expect(tabForShortcutKey("a")).toBeNull();
    expect(tabForShortcutKey("")).toBeNull();
  });
});

describe("modifierSymbol", () => {
  it("is ⌘ on mac, Ctrl elsewhere", () => {
    expect(modifierSymbol(true)).toBe("⌘");
    expect(modifierSymbol(false)).toBe("Ctrl");
  });
});

describe("SHORTCUT_TABS", () => {
  it("is the four nav tabs and never includes 'now'", () => {
    expect([...SHORTCUT_TABS]).toEqual(["queue", "search", "sessions", "settings"]);
    expect(SHORTCUT_TABS).not.toContain("now");
  });
});

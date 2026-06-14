import { describe, expect, it } from "vitest";
import { modifierSymbol, SHORTCUT_TABS, tabForCycleShortcut, tabForShortcutKey } from "./shortcuts";

describe("tabForShortcutKey", () => {
  it("maps digits 1–3 to the nav tabs in order", () => {
    expect(tabForShortcutKey("1")).toBe("now");
    expect(tabForShortcutKey("2")).toBe("search");
    expect(tabForShortcutKey("3")).toBe("settings");
  });

  it("returns null for out-of-range or non-digit keys", () => {
    expect(tabForShortcutKey("0")).toBeNull();
    expect(tabForShortcutKey("4")).toBeNull();
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

describe("tabForCycleShortcut", () => {
  it("cycles forward through the three shortcut tabs", () => {
    expect(tabForCycleShortcut("now", 1)).toBe("search");
    expect(tabForCycleShortcut("search", 1)).toBe("settings");
    expect(tabForCycleShortcut("settings", 1)).toBe("now");
  });

  it("cycles backward through the three shortcut tabs", () => {
    expect(tabForCycleShortcut("now", -1)).toBe("settings");
    expect(tabForCycleShortcut("settings", -1)).toBe("search");
    expect(tabForCycleShortcut("search", -1)).toBe("now");
  });

  it("recovers from legacy hidden tabs by entering the shortcut cycle", () => {
    expect(tabForCycleShortcut("queue", 1)).toBe("now");
    expect(tabForCycleShortcut("sessions", -1)).toBe("settings");
  });
});

describe("SHORTCUT_TABS", () => {
  it("is the three nav-FAB tabs in order: playback / gallery / settings", () => {
    expect([...SHORTCUT_TABS]).toEqual(["now", "search", "settings"]);
  });
});

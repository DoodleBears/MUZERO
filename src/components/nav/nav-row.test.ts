import { describe, expect, it } from "vitest";
import { SHORTCUT_TABS } from "@/lib/shortcuts";
import { NAV_ITEMS } from "./nav-row";

// Locks the Q1 decision: the integrated nav row drops "now" (reached by tapping
// the player area) and shows exactly four tabs, matching the Poweramp reference.
describe("NavRow items", () => {
  it("is exactly queue / search / sessions / settings, in order", () => {
    expect(NAV_ITEMS.map((i) => i.id)).toEqual(["queue", "search", "sessions", "settings"]);
  });

  it("never includes the 'now' tab", () => {
    expect(NAV_ITEMS.some((i) => (i.id as string) === "now")).toBe(false);
  });

  it("maps each tab to an existing nav.* label key", () => {
    expect(NAV_ITEMS.map((i) => i.labelKey)).toEqual(["queue", "search", "sets", "settings"]);
  });

  it("order matches the keyboard-shortcut tabs (Cmd/Ctrl+1..4)", () => {
    expect(NAV_ITEMS.map((i) => i.id)).toEqual([...SHORTCUT_TABS]);
  });
});

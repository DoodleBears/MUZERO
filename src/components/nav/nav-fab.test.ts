import { describe, expect, it } from "vitest";
import { SHORTCUT_TABS } from "@/lib/shortcuts";
import { NAV_ITEMS } from "./nav-fab";

// The redesigned nav: the few buttons merge into one collapse/expand FAB. Only
// three destinations — playback (now) · 歌单 gallery (search) · settings. Queue is
// reached inside Now Playing; sessions are browsed in the gallery; AI is its own
// floating FAB (not a nav tab).
describe("NavFab items", () => {
  it("is exactly playback / gallery / settings, in order", () => {
    expect(NAV_ITEMS.map((i) => i.id)).toEqual(["now", "search", "settings"]);
  });

  it("maps each tab to an existing nav.* label key", () => {
    expect(NAV_ITEMS.map((i) => i.labelKey)).toEqual(["now", "sets", "settings"]);
  });

  it("order matches the keyboard-shortcut tabs (Cmd/Ctrl+1..3)", () => {
    expect(NAV_ITEMS.map((i) => i.id)).toEqual([...SHORTCUT_TABS]);
  });
});

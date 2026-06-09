import { describe, expect, it } from "vitest";
import { resolveActiveSettingsItem, SETTINGS_NAV, settingsItemIds } from "./settings-nav";

describe("settings-nav", () => {
  it("flattens unique item ids across all sections", () => {
    const ids = settingsItemIds();
    expect(ids).toContain("appearance");
    expect(ids).toContain("playback-music");
    expect(ids).toContain("cloud");
    expect(ids).toContain("advanced");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every section has at least one item", () => {
    for (const section of SETTINGS_NAV) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("passes a valid active id through", () => {
    expect(resolveActiveSettingsItem("playback-music")).toBe("playback-music");
  });

  it("falls back to the first item for an unknown or empty id", () => {
    const first = settingsItemIds()[0];
    expect(resolveActiveSettingsItem("does-not-exist")).toBe(first);
    expect(resolveActiveSettingsItem("")).toBe(first);
  });
});

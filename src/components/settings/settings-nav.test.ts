import { describe, expect, it } from "vitest";
import { resolveActiveSettingsItem, SETTINGS_NAV, settingsItemIds } from "./settings-nav";

describe("settings-nav", () => {
  it("flattens unique item ids across all sections", () => {
    const ids = settingsItemIds();
    expect(ids).toContain("appearance");
    expect(ids).toContain("flow");
    expect(ids).toContain("shortcuts");
    expect(ids).toContain("playback-music");
    expect(ids).toContain("storage");
    expect(ids).toContain("cloud");
    expect(ids).not.toContain("cloud-owner");
    expect(ids).not.toContain("cloud-sync");
    expect(ids).toContain("cloud-presence");
    expect(ids).toContain("advanced");
    expect(ids).toContain("about");
    expect(ids).toContain("version-history");
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

  it("aliases stale cloud split-pane ids to the consolidated cloud drive pane", () => {
    expect(resolveActiveSettingsItem("cloud-owner")).toBe("cloud");
    expect(resolveActiveSettingsItem("cloud-sync")).toBe("cloud");
  });
});

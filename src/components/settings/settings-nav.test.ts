import { describe, expect, it } from "vitest";
import { resolveActiveSettingsItem, SETTINGS_NAV, settingsItemIds } from "./settings-nav";

describe("settings-nav", () => {
  it("flattens unique item ids across all sections", () => {
    const ids = settingsItemIds();
    expect(ids).toEqual([
      "appearance",
      "background",
      "visualizer",
      "flow",
      "lyrics",
      "performance",
      "local-files",
      "online-sources",
      "storage",
      "cloud",
      "cloud-presence",
      "ai-dj-model",
      "live-requests",
      "ai-music-generation",
      "listening-stats",
      "shortcuts",
      "playback",
      "device-profile",
      "desktop-downloads",
      "about",
      "advanced",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every section has at least one item", () => {
    for (const section of SETTINGS_NAV) {
      expect(section.items.length).toBeGreaterThan(0);
    }
  });

  it("every item declares an icon for the icon + label sidebar", () => {
    for (const section of SETTINGS_NAV) {
      for (const item of section.items) {
        expect(item.icon).toMatch(/^[a-z][a-z0-9-]*$/);
      }
    }
  });

  it("passes a valid active id through", () => {
    expect(resolveActiveSettingsItem("ai-music-generation")).toBe("ai-music-generation");
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

  it("aliases stale settings item ids to the new IA", () => {
    expect(resolveActiveSettingsItem("device")).toBe("device-profile");
    expect(resolveActiveSettingsItem("playback-dj")).toBe("ai-dj-model");
    expect(resolveActiveSettingsItem("audience-requests")).toBe("live-requests");
    expect(resolveActiveSettingsItem("playback-music")).toBe("ai-music-generation");
    expect(resolveActiveSettingsItem("stream-sources")).toBe("online-sources");
    expect(resolveActiveSettingsItem("version-history")).toBe("desktop-downloads");
  });
});

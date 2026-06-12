import { afterEach, describe, expect, it } from "vitest";
import { useNavStore } from "./nav-store";

afterEach(() => {
  useNavStore.setState({
    tab: "now",
    settingsItem: "appearance",
    pendingLibraryEntity: null,
  });
  localStorage.clear();
});

describe("nav-store — persisted active tab", () => {
  it("defaults to the Now tab", () => {
    expect(useNavStore.getState().tab).toBe("now");
  });

  it("setTab updates the active tab and persists it", () => {
    useNavStore.getState().setTab("search");
    expect(useNavStore.getState().tab).toBe("search");
    // zustand persist writes to localStorage under the configured key.
    expect(localStorage.getItem("muzero-nav")).toContain("search");
  });

  it("defaults the settings item to appearance and persists changes", () => {
    expect(useNavStore.getState().settingsItem).toBe("appearance");
    useNavStore.getState().setSettingsItem("cloud-owner");
    expect(useNavStore.getState().settingsItem).toBe("cloud-owner");
    expect(localStorage.getItem("muzero-nav")).toContain("cloud-owner");
  });

  it("queues a set open intent without persisting it", () => {
    useNavStore.getState().openSet("ses_1");
    expect(useNavStore.getState().tab).toBe("search");
    expect(useNavStore.getState().consumeLibraryEntity()).toEqual({ kind: "set", id: "ses_1" });
    expect(useNavStore.getState().pendingLibraryEntity).toBeNull();
    expect(localStorage.getItem("muzero-nav")).not.toContain("ses_1");
  });
});

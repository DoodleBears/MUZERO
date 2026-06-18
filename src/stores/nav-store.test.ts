import { afterEach, describe, expect, it } from "vitest";
import { useNavStore } from "./nav-store";

afterEach(() => {
  useNavStore.setState({
    tab: "search",
    settingsItem: "appearance",
    pendingLibraryEntity: null,
  });
  localStorage.clear();
});

describe("nav-store — persisted active tab", () => {
  it("defaults to the library tab", () => {
    expect(useNavStore.getState().tab).toBe("search");
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
    useNavStore.getState().openSet("ses_1", "trk_2");
    expect(useNavStore.getState().tab).toBe("search");
    expect(useNavStore.getState().consumeLibraryEntity()).toEqual({
      anchorTrackId: "trk_2",
      kind: "set",
      id: "ses_1",
    });
    expect(useNavStore.getState().pendingLibraryEntity).toBeNull();
    expect(localStorage.getItem("muzero-nav")).not.toContain("ses_1");
  });

  it("queues a system playlist open intent without persisting it", () => {
    useNavStore.getState().openSystemPlaylist("system:recent", "trk_9");
    expect(useNavStore.getState().tab).toBe("search");
    expect(useNavStore.getState().consumeLibraryEntity()).toEqual({
      anchorTrackId: "trk_9",
      kind: "system-playlist",
      id: "system:recent",
    });
    expect(localStorage.getItem("muzero-nav")).not.toContain("trk_9");
  });

  it("queues an online playlist intent without persisting it", () => {
    const playlist = { id: "p1", name: "Online", source: "netease" as const, trackCount: 3 };
    useNavStore.getState().openOnlinePlaylist(playlist, "trk_3");
    expect(useNavStore.getState().tab).toBe("search");
    expect(useNavStore.getState().consumeLibraryEntity()).toEqual({
      anchorTrackId: "trk_3",
      kind: "online-playlist",
      playlist,
    });
    expect(localStorage.getItem("muzero-nav")).not.toContain("p1");
  });
});

import { describe, expect, it, vi } from "vitest";
import { dispatchTrayAction, isTrayActionId } from "./actions";
import { buildTrayMenuModel, type TrayLabels, type TraySnapshot } from "./menu-model";

const labels: TrayLabels = {
  appName: "MUZERO",
  currentPrefix: "Current",
  noTrack: "No song playing",
  previous: "Previous",
  play: "Play",
  pause: "Pause",
  next: "Next",
  like: "Like current song",
  unlike: "Unlike current song",
  repeat: "Repeat",
  repeatOff: "Off",
  repeatAll: "Repeat all",
  repeatOne: "Repeat one",
  displayMode: "Display mode",
  displayVideo: "Video",
  displayCover: "Cover",
  openApp: "Open MUZERO",
  openNowPlaying: "Open Now Playing",
  settings: "Settings",
  exit: "Exit MUZERO",
};

const baseSnapshot: TraySnapshot = {
  currentTrack: {
    id: "trk_secret",
    liked: false,
    subtitle: "Dua Lipa",
    title: "Levitating",
  },
  displayMode: "video",
  isPlaying: true,
  labels,
  repeat: "all",
};

describe("buildTrayMenuModel", () => {
  it("builds a localized player menu without leaking the track id", () => {
    const menu = buildTrayMenuModel(baseSnapshot);

    expect(menu.tooltip).toBe("MUZERO - Levitating");
    expect(menu.items.map((item) => item.type)).toEqual([
      "normal",
      "separator",
      "normal",
      "normal",
      "normal",
      "checkbox",
      "separator",
      "submenu",
      "submenu",
      "separator",
      "normal",
      "normal",
      "normal",
      "separator",
      "normal",
    ]);
    expect(JSON.stringify(menu)).not.toContain("trk_secret");
    expect(menu.items[0]).toMatchObject({
      action: "nav.now",
      enabled: true,
      label: "Current: Levitating - Dua Lipa",
    });
    expect(menu.items[3]).toMatchObject({ action: "playback.toggle", label: "Pause" });
    expect(menu.items[5]).toMatchObject({
      action: "track.toggleLike",
      checked: false,
      label: "Like current song",
    });
  });

  it("disables playback actions when no current track exists", () => {
    const menu = buildTrayMenuModel({ ...baseSnapshot, currentTrack: undefined, isPlaying: false });

    expect(menu.tooltip).toBe("MUZERO");
    expect(menu.items[0]).toMatchObject({ enabled: false, label: "No song playing" });
    expect(menu.items[2]).toMatchObject({ action: "playback.prev", enabled: false });
    expect(menu.items[3]).toMatchObject({
      action: "playback.toggle",
      enabled: false,
      label: "Play",
    });
    expect(menu.items[4]).toMatchObject({ action: "playback.next", enabled: false });
    expect(menu.items[5]).toMatchObject({ action: "track.toggleLike", enabled: false });
  });

  it("marks repeat and display choices as mutually exclusive checks", () => {
    const menu = buildTrayMenuModel({ ...baseSnapshot, displayMode: "cover", repeat: "one" });
    const repeat = menu.items[7];
    const display = menu.items[8];

    expect(repeat).toMatchObject({
      items: [
        { action: "playback.repeat.off", checked: false },
        { action: "playback.repeat.all", checked: false },
        { action: "playback.repeat.one", checked: true },
      ],
      label: "Repeat",
      type: "submenu",
    });
    expect(display).toMatchObject({
      items: [
        { action: "display.mode.video", checked: false },
        { action: "display.mode.cover", checked: true },
      ],
      label: "Display mode",
      type: "submenu",
    });
  });
});

describe("tray actions", () => {
  it("guards unknown native action ids", async () => {
    const setTab = vi.fn();

    expect(isTrayActionId("playback.next")).toBe(true);
    expect(isTrayActionId("debug.rawKey")).toBe(false);
    await expect(
      dispatchTrayAction("debug.rawKey", {
        getCurrentTrack: () => null,
        next: vi.fn(),
        prev: vi.fn(),
        quitApp: vi.fn(),
        setDisplayMode: vi.fn(),
        setRepeat: vi.fn(),
        setTab,
        setTrackLiked: vi.fn(),
        showWindow: vi.fn(),
        togglePlay: vi.fn(),
      }),
    ).resolves.toBe(false);
    expect(setTab).not.toHaveBeenCalled();
  });

  it("dispatches navigation, repeat, display, playback, like, and quit actions", async () => {
    const ctx = {
      getCurrentTrack: vi.fn(() => ({ id: "trk_1", liked: false })),
      next: vi.fn(),
      prev: vi.fn(),
      quitApp: vi.fn(),
      setDisplayMode: vi.fn(),
      setRepeat: vi.fn(),
      setTab: vi.fn(),
      setTrackLiked: vi.fn(),
      showWindow: vi.fn(),
      togglePlay: vi.fn(),
    };

    await expect(dispatchTrayAction("nav.settings", ctx)).resolves.toBe(true);
    await expect(dispatchTrayAction("playback.repeat.one", ctx)).resolves.toBe(true);
    await expect(dispatchTrayAction("display.mode.cover", ctx)).resolves.toBe(true);
    await expect(dispatchTrayAction("playback.next", ctx)).resolves.toBe(true);
    await expect(dispatchTrayAction("track.toggleLike", ctx)).resolves.toBe(true);
    await expect(dispatchTrayAction("app.quit", ctx)).resolves.toBe(true);

    expect(ctx.showWindow).toHaveBeenCalledTimes(1);
    expect(ctx.setTab).toHaveBeenCalledWith("settings");
    expect(ctx.setRepeat).toHaveBeenCalledWith("one");
    expect(ctx.setDisplayMode).toHaveBeenCalledWith("cover");
    expect(ctx.next).toHaveBeenCalledTimes(1);
    expect(ctx.setTrackLiked).toHaveBeenCalledWith("trk_1", true);
    expect(ctx.quitApp).toHaveBeenCalledTimes(1);
  });
});

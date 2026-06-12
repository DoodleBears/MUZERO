import { describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "@/lib/desktop/bridge";
import { dispatchTrayAction } from "./actions";
import { createTrayActionContext } from "./use-tray-sync";

describe("createTrayActionContext", () => {
  it("routes tray actions through the existing window, nav, player, and repository APIs", async () => {
    const bridge = {
      windowControls: {
        close: vi.fn(),
        getState: vi.fn(),
        hideToTray: vi.fn(),
        minimize: vi.fn(),
        quitApp: vi.fn(),
        showFromTray: vi.fn(),
        toggleMaximize: vi.fn(),
      },
    } as unknown as DesktopBridge;
    const player = {
      next: vi.fn(),
      prev: vi.fn(),
      setDisplayMode: vi.fn(),
      setRepeat: vi.fn(),
      togglePlay: vi.fn(),
    };
    const setTab = vi.fn();
    const setTrackLiked = vi.fn();
    const context = createTrayActionContext({
      bridge,
      getCurrentTrack: () => ({ id: "trk_1", liked: false }),
      getPlayer: () => player,
      setTab,
      setTrackLiked,
    });

    await dispatchTrayAction("nav.settings", context);
    await dispatchTrayAction("playback.next", context);
    await dispatchTrayAction("playback.repeat.one", context);
    await dispatchTrayAction("display.mode.cover", context);
    await dispatchTrayAction("track.toggleLike", context);
    await dispatchTrayAction("app.quit", context);

    expect(bridge.windowControls?.showFromTray).toHaveBeenCalledTimes(1);
    expect(setTab).toHaveBeenCalledWith("settings");
    expect(player.next).toHaveBeenCalledTimes(1);
    expect(player.setRepeat).toHaveBeenCalledWith("one");
    expect(player.setDisplayMode).toHaveBeenCalledWith("cover");
    expect(setTrackLiked).toHaveBeenCalledWith("trk_1", true);
    expect(bridge.windowControls?.quitApp).toHaveBeenCalledTimes(1);
  });
});

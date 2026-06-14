import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getState: vi.fn(),
  isPlaying: false,
  next: vi.fn(),
  onStateChange: vi.fn(),
  prev: vi.fn(),
  saveSettings: vi.fn(),
  setClickThroughRegions: vi.fn(),
  setClickThroughPaused: vi.fn(),
  setPinMode: vi.fn(),
  togglePlay: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/db/repositories", () => ({
  saveSettings: state.saveSettings,
}));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    kind: "electron",
    platform: "win32",
    windowControls: {
      getState: state.getState,
      onStateChange: state.onStateChange,
      setClickThroughRegions: state.setClickThroughRegions,
      setClickThroughPaused: state.setClickThroughPaused,
      setPinMode: state.setPinMode,
    },
  }),
}));

vi.mock("@/stores/player-store", () => ({
  usePlayerStore: (selector: (state: unknown) => unknown) =>
    selector({
      isPlaying: state.isPlaying,
      next: state.next,
      prev: state.prev,
      togglePlay: state.togglePlay,
    }),
}));

import { __resetDesktopWindowStoreForTest } from "@/stores/desktop-window-store";
import { FloatingUnpinButton } from "./floating-unpin-button";

describe("FloatingUnpinButton", () => {
  beforeEach(() => {
    __resetDesktopWindowStoreForTest();
    state.getState.mockReset();
    state.getState.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });
    state.isPlaying = false;
    state.next.mockReset();
    state.next.mockResolvedValue(undefined);
    state.onStateChange.mockReset();
    state.onStateChange.mockReturnValue(() => undefined);
    state.prev.mockReset();
    state.prev.mockResolvedValue(undefined);
    state.saveSettings.mockReset();
    state.saveSettings.mockResolvedValue(undefined);
    state.setClickThroughRegions.mockReset();
    state.setClickThroughRegions.mockResolvedValue(undefined);
    state.setClickThroughPaused.mockReset();
    state.setClickThroughPaused.mockResolvedValue(undefined);
    state.setPinMode.mockReset();
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "off" });
    state.togglePlay.mockReset();
  });

  it("pauses click-through over the revealed button and restores it away from the button", () => {
    render(<FloatingUnpinButton revealed={true} />);

    const toolbar = screen.getByRole("toolbar", { name: "windowControls.lyricsOverlayControls" });
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
      bottom: 56,
      height: 36,
      left: 40,
      right: 76,
      toJSON: () => undefined,
      top: 20,
      width: 36,
      x: 40,
      y: 20,
    });

    fireEvent.pointerMove(window, { clientX: 48, clientY: 28 });
    expect(state.setClickThroughPaused).toHaveBeenLastCalledWith(true);

    fireEvent.pointerMove(window, { clientX: 10, clientY: 10 });
    expect(state.setClickThroughPaused).toHaveBeenLastCalledWith(false);
  });

  it("registers the overlay bar rect as a native click-through hover region", async () => {
    render(<FloatingUnpinButton revealed={true} />);

    const toolbar = await screen.findByRole("toolbar", {
      name: "windowControls.lyricsOverlayControls",
    });
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
      bottom: 64,
      height: 44,
      left: 120,
      right: 320,
      toJSON: () => undefined,
      top: 20,
      width: 200,
      x: 120,
      y: 20,
    });

    fireEvent.resize(window);

    await waitFor(() =>
      expect(state.setClickThroughRegions).toHaveBeenLastCalledWith([
        { height: 44, width: 200, x: 120, y: 20 },
      ]),
    );
  });

  it("turns pin mode off when clicked", async () => {
    render(<FloatingUnpinButton revealed={true} />);

    fireEvent.click(await screen.findByRole("button", { name: "windowControls.unpin" }));

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("off"));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "off" });
  });

  it("locks the pinned lyrics window into click-through without persisting click-through", async () => {
    render(<FloatingUnpinButton revealed={true} />);

    fireEvent.click(await screen.findByRole("button", { name: "windowControls.lockClickThrough" }));

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("pin-click-through"));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "pin" });
  });

  it("unlocks click-through while keeping the window pinned", async () => {
    state.getState.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin-click-through",
    });
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });

    render(<FloatingUnpinButton revealed={true} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "windowControls.unlockClickThrough" }),
    );

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("pin"));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "pin" });
  });

  it("keeps the locked overlay bar hoverable so click-through can be unlocked", async () => {
    state.getState.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin-click-through",
    });
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });

    render(<FloatingUnpinButton revealed={true} />);

    const toolbar = await screen.findByRole("toolbar", {
      name: "windowControls.lyricsOverlayControls",
    });
    vi.spyOn(toolbar, "getBoundingClientRect").mockReturnValue({
      bottom: 56,
      height: 36,
      left: 40,
      right: 76,
      toJSON: () => undefined,
      top: 20,
      width: 36,
      x: 40,
      y: 20,
    });
    const unlock = await screen.findByRole("button", {
      name: "windowControls.unlockClickThrough",
    });

    fireEvent.pointerMove(window, { clientX: 48, clientY: 28 });
    expect(state.setClickThroughPaused).toHaveBeenLastCalledWith(true);
    expect(unlock).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(unlock);

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("pin"));
  });

  it("surfaces transport controls in the lyrics overlay", async () => {
    render(<FloatingUnpinButton revealed={true} />);

    fireEvent.click(await screen.findByRole("button", { name: "player.previous" }));
    fireEvent.click(await screen.findByRole("button", { name: "player.play" }));
    fireEvent.click(await screen.findByRole("button", { name: "player.next" }));

    expect(state.prev).toHaveBeenCalledTimes(1);
    expect(state.togglePlay).toHaveBeenCalledTimes(1);
    expect(state.next).toHaveBeenCalledTimes(1);
  });

  it("shows pause when playback is active", async () => {
    state.isPlaying = true;

    render(<FloatingUnpinButton revealed={true} />);

    expect(await screen.findByRole("button", { name: "player.pause" })).toBeTruthy();
  });
});

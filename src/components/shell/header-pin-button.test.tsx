import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getState: vi.fn(),
  onStateChange: vi.fn(),
  saveSettings: vi.fn(),
  setClickThroughPaused: vi.fn(),
  setPinMode: vi.fn(),
  supported: true,
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
    kind: state.supported ? "electron" : "web",
    platform: "win32",
    windowControls: state.supported
      ? {
          getState: state.getState,
          onStateChange: state.onStateChange,
          setClickThroughPaused: state.setClickThroughPaused,
          setPinMode: state.setPinMode,
        }
      : undefined,
  }),
}));

import { __resetDesktopWindowStoreForTest } from "@/stores/desktop-window-store";
import { HeaderPinButton } from "./header-pin-button";

describe("HeaderPinButton", () => {
  beforeEach(() => {
    __resetDesktopWindowStoreForTest();
    state.supported = true;
    state.getState.mockReset();
    state.getState.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "off" });
    state.onStateChange.mockReset();
    state.onStateChange.mockReturnValue(() => undefined);
    state.saveSettings.mockReset();
    state.saveSettings.mockResolvedValue(undefined);
    state.setClickThroughPaused.mockReset();
    state.setClickThroughPaused.mockResolvedValue(undefined);
    state.setPinMode.mockReset();
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });
  });

  it("does not render when the desktop bridge has no pin controls", () => {
    state.supported = false;

    render(<HeaderPinButton />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads click-through as pinned without making pin itself a click-through control", async () => {
    state.getState.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin-click-through",
    });

    render(<HeaderPinButton />);

    const button = await screen.findByRole("button", {
      name: "windowControls.pinOn",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("toggles pin mode on and persists only restart-safe states", async () => {
    render(<HeaderPinButton />);

    fireEvent.click(await screen.findByRole("button", { name: "windowControls.pinOff" }));

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("pin"));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "pin" });
    expect(await screen.findByRole("button", { name: "windowControls.pinOn" })).toBeTruthy();
  });

  it("turns pin off instead of cycling from pinned into click-through", async () => {
    state.getState.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin",
    });
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "off" });

    render(<HeaderPinButton />);

    fireEvent.click(await screen.findByRole("button", { name: "windowControls.pinOn" }));

    await waitFor(() => expect(state.setPinMode).toHaveBeenCalledWith("off"));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "off" });
  });

  it("subscribes to shell state changes", async () => {
    type StateListener = (state: { pinMode?: "off" | "pin" | "pin-click-through" }) => void;
    let listener: StateListener | undefined;
    state.onStateChange.mockImplementation((callback) => {
      listener = callback;
      return () => undefined;
    });

    render(<HeaderPinButton />);
    await screen.findByRole("button", { name: "windowControls.pinOff" });

    (listener as StateListener)({ pinMode: "pin" });

    expect(await screen.findByRole("button", { name: "windowControls.pinOn" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

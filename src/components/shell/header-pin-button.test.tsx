import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cyclePinMode: vi.fn(),
  getState: vi.fn(),
  onStateChange: vi.fn(),
  saveSettings: vi.fn(),
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
    windowControls: state.supported
      ? {
          cyclePinMode: state.cyclePinMode,
          getState: state.getState,
          onStateChange: state.onStateChange,
        }
      : undefined,
  }),
}));

import { HeaderPinButton } from "./header-pin-button";

describe("HeaderPinButton", () => {
  beforeEach(() => {
    state.supported = true;
    state.getState.mockReset();
    state.getState.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "off" });
    state.cyclePinMode.mockReset();
    state.cyclePinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });
    state.onStateChange.mockReset();
    state.onStateChange.mockReturnValue(() => undefined);
    state.saveSettings.mockReset();
    state.saveSettings.mockResolvedValue(undefined);
  });

  it("does not render when the desktop bridge has no pin controls", () => {
    state.supported = false;

    render(<HeaderPinButton />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reads the current pin state from the desktop bridge", async () => {
    state.getState.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin-click-through",
    });

    render(<HeaderPinButton />);

    const button = await screen.findByRole("button", {
      name: "windowControls.pinClickThrough",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("cycles pin mode and persists only restart-safe states", async () => {
    state.cyclePinMode.mockResolvedValue({
      fullscreen: false,
      maximized: false,
      pinMode: "pin-click-through",
    });

    render(<HeaderPinButton />);

    fireEvent.click(await screen.findByRole("button", { name: "windowControls.pinOff" }));

    await waitFor(() => expect(state.cyclePinMode).toHaveBeenCalledTimes(1));
    expect(state.saveSettings).toHaveBeenCalledWith({ desktopWindowPinMode: "pin" });
    expect(
      await screen.findByRole("button", { name: "windowControls.pinClickThrough" }),
    ).toBeTruthy();
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

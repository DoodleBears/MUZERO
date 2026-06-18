import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirror header-pin-button.test.tsx's bridge mock so the desktop-window-store
// resolves a fake Electron shell; flip `platform` / `kind` per test.
const state = vi.hoisted(() => ({
  getState: vi.fn(),
  hasControls: true,
  kind: "electron" as "electron" | "web",
  onStateChange: vi.fn(),
  platform: "darwin" as "darwin" | "win32" | undefined,
  setClickThroughPaused: vi.fn(),
  setPinMode: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/db/repositories", () => ({ saveSettings: vi.fn() }));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => ({
    kind: state.kind,
    platform: state.platform,
    windowControls: state.hasControls
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
import { MacWindowControls } from "./mac-window-controls";

describe("MacWindowControls", () => {
  beforeEach(() => {
    __resetDesktopWindowStoreForTest();
    state.kind = "electron";
    state.platform = "darwin";
    state.hasControls = true;
    state.getState.mockReset();
    state.getState.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "off" });
    state.onStateChange.mockReset();
    state.onStateChange.mockReturnValue(() => undefined);
    state.setPinMode.mockReset();
    state.setPinMode.mockResolvedValue({ fullscreen: false, maximized: false, pinMode: "pin" });
    state.setClickThroughPaused.mockReset();
    state.setClickThroughPaused.mockResolvedValue(undefined);
  });

  it("renders the pin button on the macOS Electron shell", async () => {
    render(<MacWindowControls />);
    expect(await screen.findByRole("button", { name: "windowControls.pinOff" })).toBeTruthy();
  });

  it("shows only the pin control — no minimize / maximize / close (those stay native traffic lights)", async () => {
    render(<MacWindowControls />);
    await screen.findByRole("button", { name: "windowControls.pinOff" });

    expect(screen.queryByRole("button", { name: "windowControls.minimize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "windowControls.maximize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "windowControls.close" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("does not render on the Windows shell (it owns its own controls cluster)", () => {
    state.platform = "win32";
    render(<MacWindowControls />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not render on the web (no pin capability)", () => {
    state.kind = "web";
    state.hasControls = false;
    render(<MacWindowControls />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

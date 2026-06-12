import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SETTINGS } from "@/db/types";
import { VisualizerModeButton } from "./visualizer-mode-button";

const state = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  settings: {} as AppSettings,
  setPanelOpen: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === "visualizer.toggleMode" ? `Visualizer: ${opts?.mode}` : key,
  }),
}));

vi.mock("@/components/player/control-tooltip", () => ({
  ControlTooltip: ({ children }: { children: ReactElement }) => children,
}));

vi.mock("@/db/repositories", () => ({
  saveSettings: state.saveSettings,
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => state.settings,
}));

vi.mock("@/stores/visualizer-panel-store", () => ({
  useVisualizerPanelStore: (selector: (store: { setOpen: (open: boolean) => void }) => unknown) =>
    selector({ setOpen: state.setPanelOpen }),
}));

describe("VisualizerModeButton", () => {
  beforeEach(() => {
    state.saveSettings.mockReset();
    state.setPanelOpen.mockReset();
    state.settings = { ...DEFAULT_SETTINGS };
  });

  it("labels the lyrics-only placement and cycles it back to off", () => {
    state.settings = {
      ...DEFAULT_SETTINGS,
      visualizerStyle: "bars",
      visualizerAsBackground: true,
      visualizerIdleOnly: true,
      visualizerLyricsOnlyIdle: true,
    };

    render(<VisualizerModeButton />);

    const button = screen.getByRole("button", {
      name: "Visualizer: visualizer.modeLyricsOnly",
    });
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);

    expect(state.saveSettings).toHaveBeenCalledWith({
      visualizerAsBackground: false,
      visualizerIdleOnly: false,
      visualizerLyricsOnlyIdle: false,
    });
  });
});

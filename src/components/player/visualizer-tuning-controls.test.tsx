import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@/db/types";
import { VisualizerTuningControls } from "./visualizer-tuning-controls";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const saveSettings = vi.fn();
vi.mock("@/db/repositories", () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}));

let settings: AppSettings = { ...DEFAULT_SETTINGS };
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => settings,
}));

beforeEach(() => {
  settings = {
    ...DEFAULT_SETTINGS,
    visualizerStyle: "bars",
    visualizerAsBackground: true,
    visualizerTuningByStyle: {
      bars: { intensity: 1, glow: 1.2 },
      aura: { glow: 0.5 },
    },
  };
  saveSettings.mockClear();
});

describe("VisualizerTuningControls", () => {
  it("renders help buttons for visible tuning parameters", () => {
    render(<VisualizerTuningControls />);

    expect(screen.getByRole("button", { name: "visualizer.help.fftSize" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "visualizer.help.smoothing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "visualizer.help.intensity" })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "visualizer.help.backgroundOpacity" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "visualizer.help.backgroundDim" }).length,
    ).toBeGreaterThan(0);
  });

  it("saves slider changes into the active style tuning entry", () => {
    render(<VisualizerTuningControls />);

    fireEvent.keyDown(screen.getByRole("slider", { name: "visualizer.intensity" }), {
      key: "ArrowUp",
    });

    expect(saveSettings).toHaveBeenCalledWith({
      visualizerTuningByStyle: {
        bars: { intensity: 1.05, glow: 1.2 },
        aura: { glow: 0.5 },
      },
    });
  });

  it("resets only the active style tuning", () => {
    render(<VisualizerTuningControls />);

    fireEvent.click(screen.getByRole("button", { name: "visualizer.resetStyle" }));

    expect(saveSettings).toHaveBeenCalledWith({
      visualizerTuningByStyle: {
        aura: { glow: 0.5 },
      },
    });
  });
});

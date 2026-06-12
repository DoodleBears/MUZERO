import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SETTINGS } from "@/db/types";
import { LyricsTuningControls } from "./lyrics-tuning-controls";

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
  settings = { ...DEFAULT_SETTINGS };
  saveSettings.mockClear();
});

describe("LyricsTuningControls", () => {
  it("defaults the lyrics motion mode to classic", () => {
    settings = { ...DEFAULT_SETTINGS, lyricsMotionMode: undefined };

    render(<LyricsTuningControls />);

    expect(screen.getByRole("button", { name: "lyricsSettings.motionClassic" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("saves the selected lyrics motion mode", () => {
    render(<LyricsTuningControls />);

    fireEvent.click(screen.getByRole("button", { name: "lyricsSettings.motionCascade" }));

    expect(saveSettings).toHaveBeenCalledWith({ lyricsMotionMode: "cascade" });
  });

  it("describes cascade as Apple Music-like for hover help", () => {
    render(<LyricsTuningControls />);

    expect(screen.getByRole("button", { name: "lyricsSettings.motionCascade" })).toHaveAttribute(
      "title",
      "lyricsSettings.motionCascadeHint",
    );
  });
});

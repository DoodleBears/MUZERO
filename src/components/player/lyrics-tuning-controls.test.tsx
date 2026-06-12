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

  it("shows cascade-only tuning sliders in cascade mode and saves changes", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      lyricsMotionMode: "cascade",
      lyricsCascadeAnchorPct: 42,
      lyricsCascadeDelayMs: 52,
      lyricsCascadeBlurPx: 4.2,
    };

    render(<LyricsTuningControls />);

    const anchor = screen.getByRole("slider", { name: "lyricsSettings.cascadeAnchor" });
    const delay = screen.getByRole("slider", { name: "lyricsSettings.cascadeDelay" });
    const blur = screen.getByRole("slider", { name: "lyricsSettings.cascadeBlur" });

    fireEvent.keyDown(anchor, { key: "ArrowRight" });
    fireEvent.keyDown(delay, { key: "ArrowRight" });
    fireEvent.keyDown(blur, { key: "ArrowRight" });

    expect(saveSettings).toHaveBeenCalledWith({ lyricsCascadeAnchorPct: 43 });
    expect(saveSettings).toHaveBeenCalledWith({ lyricsCascadeDelayMs: 53 });
    expect(saveSettings).toHaveBeenCalledWith({ lyricsCascadeBlurPx: 4.3 });
  });

  it("hides cascade-only tuning sliders outside cascade mode", () => {
    settings = { ...DEFAULT_SETTINGS, lyricsMotionMode: "classic" };

    render(<LyricsTuningControls />);

    expect(screen.queryByRole("slider", { name: "lyricsSettings.cascadeAnchor" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "lyricsSettings.cascadeDelay" })).toBeNull();
    expect(screen.queryByRole("slider", { name: "lyricsSettings.cascadeBlur" })).toBeNull();
  });
});

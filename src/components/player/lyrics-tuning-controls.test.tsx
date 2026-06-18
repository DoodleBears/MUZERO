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
  it("defaults the lyrics motion mode to cascade", () => {
    settings = { ...DEFAULT_SETTINGS, lyricsMotionMode: undefined };

    render(<LyricsTuningControls />);

    expect(screen.getByRole("button", { name: "lyricsSettings.motionCascade" })).toHaveAttribute(
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

  it("shows cover color tuning sliders in cover color mode and saves changes", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      lyricsColorMode: "cover",
      lyricsCoverColorSaturation: 100,
      lyricsCoverColorBrightness: 100,
      lyricsCoverColorContrast: 100,
    };

    render(<LyricsTuningControls />);

    const saturation = screen.getByRole("slider", {
      name: "lyricsSettings.coverColorSaturation",
    });
    const brightness = screen.getByRole("slider", {
      name: "lyricsSettings.coverColorBrightness",
    });
    const contrast = screen.getByRole("slider", { name: "lyricsSettings.coverColorContrast" });

    fireEvent.keyDown(saturation, { key: "ArrowRight" });
    fireEvent.keyDown(brightness, { key: "ArrowRight" });
    fireEvent.keyDown(contrast, { key: "ArrowRight" });

    expect(saveSettings).toHaveBeenCalledWith({ lyricsCoverColorSaturation: 105 });
    expect(saveSettings).toHaveBeenCalledWith({ lyricsCoverColorBrightness: 105 });
    expect(saveSettings).toHaveBeenCalledWith({ lyricsCoverColorContrast: 105 });
  });

  it("shows the dark-mode cover color preset when tuning values are unset", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      theme: "dark",
      lyricsColorMode: "cover",
      lyricsCoverColorSaturation: undefined,
      lyricsCoverColorBrightness: undefined,
      lyricsCoverColorContrast: undefined,
    };

    render(<LyricsTuningControls />);

    expect(
      screen.getByRole("slider", { name: "lyricsSettings.coverColorSaturation" }),
    ).toHaveAttribute("aria-valuenow", "100");
    expect(
      screen.getByRole("slider", { name: "lyricsSettings.coverColorBrightness" }),
    ).toHaveAttribute("aria-valuenow", "150");
    expect(
      screen.getByRole("slider", { name: "lyricsSettings.coverColorContrast" }),
    ).toHaveAttribute("aria-valuenow", "100");
  });

  it("shows the light-mode cover color brightness preset when tuning values are unset", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      theme: "light",
      lyricsColorMode: "cover",
      lyricsCoverColorBrightness: undefined,
    };

    render(<LyricsTuningControls />);

    expect(
      screen.getByRole("slider", { name: "lyricsSettings.coverColorBrightness" }),
    ).toHaveAttribute("aria-valuenow", "50");
  });

  it("keeps cover color slider dragging local until pointer release", () => {
    settings = {
      ...DEFAULT_SETTINGS,
      lyricsColorMode: "cover",
      lyricsCoverColorSaturation: 100,
    };

    render(<LyricsTuningControls />);

    const saturation = screen.getByRole("slider", {
      name: "lyricsSettings.coverColorSaturation",
    });
    const lane = saturation.firstElementChild as HTMLElement;
    Object.defineProperty(lane, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 0,
          right: 200,
          top: 0,
          bottom: 20,
          width: 200,
          height: 20,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect,
    });
    Object.defineProperty(saturation, "setPointerCapture", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(saturation, "hasPointerCapture", {
      configurable: true,
      value: vi.fn(() => true),
    });
    Object.defineProperty(saturation, "releasePointerCapture", {
      configurable: true,
      value: vi.fn(),
    });

    fireEvent.pointerDown(saturation, { clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(saturation, { buttons: 1, clientX: 150, pointerId: 1 });

    expect(saturation).toHaveAttribute("aria-valuenow", "150");
    expect(saveSettings).not.toHaveBeenCalled();

    fireEvent.pointerUp(saturation, { clientX: 150, pointerId: 1 });

    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(saveSettings).toHaveBeenCalledWith({ lyricsCoverColorSaturation: 150 });
  });

  it("hides cover color tuning sliders outside cover color mode", () => {
    settings = { ...DEFAULT_SETTINGS, lyricsColorMode: "default" };

    render(<LyricsTuningControls />);

    expect(
      screen.queryByRole("slider", { name: "lyricsSettings.coverColorSaturation" }),
    ).toBeNull();
    expect(
      screen.queryByRole("slider", { name: "lyricsSettings.coverColorBrightness" }),
    ).toBeNull();
    expect(screen.queryByRole("slider", { name: "lyricsSettings.coverColorContrast" })).toBeNull();
  });
});

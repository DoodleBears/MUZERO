import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@/db/types";
import { VisualizerSettings } from "@/components/settings/visualizer-settings";
import { VisualizerTuningPanel } from "./visualizer-tuning-panel";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/db/repositories", () => ({
  saveSettings: vi.fn(),
}));

let settings: AppSettings = { ...DEFAULT_SETTINGS };
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => settings,
}));

const panelState = {
  open: true,
  previewOnly: false,
  visualizerHidden: false,
  setOpen: vi.fn(),
  setPreviewOnly: vi.fn(),
  setVisualizerHidden: vi.fn(),
};
vi.mock("@/stores/visualizer-panel-store", () => ({
  useVisualizerPanelStore: (selector: (state: typeof panelState) => unknown) => selector(panelState),
}));

function controlIds(container: HTMLElement) {
  return [...container.querySelectorAll("[data-visualizer-control]")].map((el) =>
    el.getAttribute("data-visualizer-control"),
  );
}

beforeEach(() => {
  settings = {
    ...DEFAULT_SETTINGS,
    visualizerStyle: "bars",
    visualizerAsBackground: true,
    visualizerIdleOnly: true,
    immersiveMemoryOverlay: true,
  };
});

describe("visualizer controls parity", () => {
  it("keeps Settings and Now Playing visualizer controls in the same persistent order", () => {
    const settingsView = render(<VisualizerSettings />);
    const panelView = render(<VisualizerTuningPanel />);

    const settingsIds = controlIds(settingsView.container);
    const panelIds = controlIds(panelView.container).filter((id) => id !== "preview-only");

    expect(panelIds).toEqual(settingsIds);
    expect(controlIds(panelView.container)).toContain("preview-only");
  });
});

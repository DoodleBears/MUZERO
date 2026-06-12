import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/db/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const saveSettings = vi.fn();
vi.mock("@/db/repositories", () => ({
  saveSettings: (...args: unknown[]) => saveSettings(...args),
}));

let settings = { ...DEFAULT_SETTINGS };
vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => settings,
}));

const bridge = {
  liveRequestIntake: {
    start: vi.fn(),
    status: vi.fn(),
    stop: vi.fn(),
    onMessage: vi.fn(() => () => undefined),
  },
};

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => bridge,
}));

import { LiveRequestSettings } from "./live-request-settings";

beforeEach(() => {
  settings = { ...DEFAULT_SETTINGS };
  saveSettings.mockClear();
  bridge.liveRequestIntake.start.mockClear();
  bridge.liveRequestIntake.status.mockClear();
  bridge.liveRequestIntake.status.mockResolvedValue({ supported: true, listening: false });
  bridge.liveRequestIntake.stop.mockClear();
  bridge.liveRequestIntake.onMessage.mockClear();
});

describe("LiveRequestSettings", () => {
  it("renders endpoint setup and defaults from local settings", () => {
    render(<LiveRequestSettings />);

    expect(screen.getByText("settings.liveRequestsTitle")).toBeInTheDocument();
    expect(screen.getByDisplayValue("41731")).toBeInTheDocument();
    expect(screen.getByLabelText("settings.liveRequestsRoute")).toHaveValue("library-search");
    expect(screen.getByLabelText("settings.liveRequestsPlaybackAction")).toHaveValue("play-next");
    expect(screen.getByText("http://127.0.0.1:41731/v1/audience/request")).toBeInTheDocument();
  });

  it("saves route and playback changes without enabling the listener implicitly", () => {
    render(<LiveRequestSettings />);

    fireEvent.change(screen.getByLabelText("settings.liveRequestsRoute"), {
      target: { value: "hybrid" },
    });
    fireEvent.change(screen.getByLabelText("settings.liveRequestsPlaybackAction"), {
      target: { value: "append-queue" },
    });

    expect(saveSettings).toHaveBeenCalledWith({
      audienceRequestIntake: expect.objectContaining({
        enabled: false,
        routeMode: "hybrid",
        playbackAction: "append-queue",
      }),
    });
  });

  it("regenerates a local token and keeps request inbox rows ephemeral", () => {
    render(<LiveRequestSettings />);

    fireEvent.click(screen.getByText("settings.liveRequestsRegenerateToken"));
    expect(saveSettings).toHaveBeenCalledWith({
      audienceRequestIntake: expect.objectContaining({
        authToken: expect.stringMatching(/^muz_live_/),
      }),
    });
    expect(screen.getByText("settings.liveRequestsInboxEmpty")).toBeInTheDocument();
  });
});

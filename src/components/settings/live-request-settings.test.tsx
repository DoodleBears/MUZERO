import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const applyLiveRequestIntake = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/live-requests/live-request-controller", () => ({
  applyLiveRequestIntake: (...args: unknown[]) => applyLiveRequestIntake(...args),
  getCapturedLiveRequests: () => [],
}));

const bridge = {
  kind: "electron",
  liveRequestIntake: {
    start: vi.fn(),
    stop: vi.fn(),
    status: vi.fn(),
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
  applyLiveRequestIntake.mockClear();
  bridge.liveRequestIntake.onMessage.mockClear();
});

describe("LiveRequestSettings", () => {
  it("renders the title and the default source card", () => {
    render(<LiveRequestSettings />);

    expect(screen.getByText("settings.liveRequestsTitle")).toBeInTheDocument();
    expect(screen.getByText("settings.liveRequestsTransport")).toBeInTheDocument();
    // The default auto-mapping source renders as an editable card.
    expect(screen.getByDisplayValue("Default")).toBeInTheDocument();
  });

  it("enables the listener through saveSettings + transport apply", async () => {
    render(<LiveRequestSettings />);

    fireEvent.click(screen.getAllByRole("checkbox")[0]);

    expect(saveSettings).toHaveBeenCalledWith({
      audienceRequestIntake: expect.objectContaining({ enabled: true }),
    });
    await waitFor(() => expect(applyLiveRequestIntake).toHaveBeenCalled());
  });

  it("adds a new source to the list", () => {
    render(<LiveRequestSettings />);

    fireEvent.click(screen.getByText("settings.liveRequestsAddSource"));

    const lastCall = saveSettings.mock.calls.at(-1)?.[0];
    expect(lastCall.audienceRequestIntake.sources).toHaveLength(2);
    expect(lastCall.audienceRequestIntake.sources[1]).toMatchObject({ status: "testing" });
  });
});

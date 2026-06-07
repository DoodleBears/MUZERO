import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NowPlayingPanel } from "./now-playing-panel";

const mocks = vi.hoisted(() => ({
  collapsed: false,
  saveSettings: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "nowPlaying.closeQueue": "Close queue",
        "nowPlaying.lyrics": "Lyrics",
        "nowPlaying.playingFrom": "Playing from",
        "nowPlaying.upNext": "Up next",
        "queue.empty": "Queue empty",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSession: () => ({ name: "Late Set" }),
  useSettings: () => ({ nowPlayingRightRailCollapsed: mocks.collapsed }),
}));

vi.mock("@/db/repositories", () => ({
  saveSettings: mocks.saveSettings,
}));

vi.mock("@/components/library/virtual-track-list", () => ({
  VirtualTrackList: () => <div data-testid="queue-list" />,
}));

describe("NowPlayingPanel collapse", () => {
  beforeEach(() => {
    mocks.collapsed = false;
    mocks.saveSettings.mockReset();
  });

  it("persists collapse requests from the desktop right rail", () => {
    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "expanded");
    expect(screen.getByTestId("queue-list")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close queue" }));

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: true });
  });

  it("keeps only the compact header when collapsed and can expand again", () => {
    mocks.collapsed = true;

    render(<NowPlayingPanel collapsible />);

    expect(screen.getByTestId("now-playing-panel")).toHaveAttribute("data-state", "collapsed");
    expect(screen.queryByTestId("queue-list")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Up next" }));

    expect(mocks.saveSettings).toHaveBeenCalledWith({ nowPlayingRightRailCollapsed: false });
  });
});

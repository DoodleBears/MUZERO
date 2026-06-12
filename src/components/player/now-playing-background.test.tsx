import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { NowPlayingBackground } from "./now-playing-background";

const mocks = vi.hoisted(() => ({
  settings: {
    backgroundMode: "cover",
    flowEnabled: true,
    visualizerAsBackground: true,
    visualizerStyle: "bars",
  },
}));

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (_query: () => unknown, _deps: unknown[], defaultValue: unknown) => defaultValue,
}));

vi.mock("@/db/repositories", () => ({
  getTrackLyrics: vi.fn(),
  listGalleryImages: vi.fn(),
  listTrackBackgrounds: vi.fn(),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => mocks.settings,
}));

vi.mock("@/hooks/use-media", () => ({
  useObjectUrls: () => [],
  useTrackCoverUrl: () => null,
  useTrackMediaUrl: () => null,
}));

vi.mock("@/visualizer/host", () => ({
  VisualizerHost: ({ styleId }: { styleId?: string }) => (
    <div data-style-id={styleId ?? "default"} data-testid="visualizer-host" />
  ),
}));

describe("NowPlayingBackground", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentIndex: -1,
      isPlaying: false,
      queue: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not mount flow or visualizer effects when no current track is selected", () => {
    render(<NowPlayingBackground active />);

    expect(screen.queryByTestId("visualizer-host")).not.toBeInTheDocument();
  });

  it("can mount the flow layer once a current track exists", () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_current")],
    });

    render(<NowPlayingBackground active />);

    expect(screen.getAllByTestId("visualizer-host").map((node) => node.dataset.styleId)).toContain(
      "scene-flow",
    );
  });
});

function makeTrack(id: string): Track {
  return {
    createdAt: 1,
    durationSec: 30,
    id,
    kind: "audio",
    liked: false,
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: "Current Song",
  };
}

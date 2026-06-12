import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { TrackInspectorPanel } from "./track-inspector-panel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-media", () => ({
  useTrackCoverUrl: () => null,
}));

vi.mock("./annotation-editor", () => ({
  AnnotationEditor: ({ track }: { track: Track }) => (
    <div data-testid="annotation-editor">memories for {track.title}</div>
  ),
}));

function track(): Track {
  return {
    createdAt: 1,
    durationSec: 125,
    id: "trk_1",
    kind: "audio",
    liked: false,
    mediaMetadata: {
      album: "Moon Record",
      artists: ["Deidian"],
      genres: ["Ambient"],
      parsedAt: 1,
      parser: "music-metadata",
      year: 2026,
    },
    origin: "uploaded",
    playCount: 0,
    provider: "upload",
    sessionId: "ses_1",
    status: "ready",
    tags: [],
    title: "Moonstone Beach",
    updatedAt: 1,
  } as Track;
}

describe("TrackInspectorPanel", () => {
  it("shows track metadata and the shared annotation editor", () => {
    render(<TrackInspectorPanel track={track()} />);

    expect(screen.getByText("Moonstone Beach")).toBeInTheDocument();
    expect(screen.getAllByText("Deidian")).toHaveLength(2);
    expect(screen.getByText("Moon Record")).toBeInTheDocument();
    expect(screen.getByText("Ambient")).toBeInTheDocument();
    expect(screen.getByText("gallery.trackSourceMissing")).toBeInTheDocument();
    expect(screen.getByText("gallery.trackCoverMissing")).toBeInTheDocument();
    expect(screen.getByTestId("annotation-editor")).toHaveTextContent(
      "memories for Moonstone Beach",
    );
  });

  it("shows cloud media and external cover source details", () => {
    render(
      <TrackInspectorPanel
        track={{
          ...track(),
          cloudSource: { driveId: "drv_1", driveLabel: "Studio R2" },
          remoteMediaUrl: "https://r2.example.com/objects/media/song.mp3",
          remoteCoverUrl: "https://p1.music.126.net/cover.jpg",
        }}
      />,
    );

    expect(screen.getByText("gallery.trackSourceR2File · r2.example.com")).toBeInTheDocument();
    expect(screen.getByText("gallery.trackCoverUrl · p1.music.126.net")).toBeInTheDocument();
  });

  it("shows a repair action for referenced local-file tracks", () => {
    render(
      <TrackInspectorPanel
        track={{
          ...track(),
          sourcePath: "/music/Moonstone Beach.mp3",
        }}
      />,
    );

    expect(screen.getByText("gallery.trackSourceLocalFile")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gallery.repairLocalFile" })).toBeInTheDocument();
  });

  it("shows the empty selection state", () => {
    render(<TrackInspectorPanel track={undefined} />);

    expect(screen.getByText("gallery.noTrackSelected")).toBeInTheDocument();
  });
});

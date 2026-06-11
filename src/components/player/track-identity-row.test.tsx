import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { TrackIdentityRow } from "./track-identity-row";

vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const passthrough = (tag: "button" | "span") =>
    React.forwardRef<HTMLElement, Record<string, unknown>>((props, ref) => {
      const {
        animate,
        children,
        drag,
        dragConstraints,
        dragDirectionLock,
        dragElastic,
        dragMomentum,
        dragSnapToOrigin,
        exit,
        initial,
        layoutId,
        onDragEnd,
        onDragStart,
        transition,
        ...domProps
      } = props;
      void animate;
      void drag;
      void dragConstraints;
      void dragDirectionLock;
      void dragElastic;
      void dragMomentum;
      void dragSnapToOrigin;
      void exit;
      void initial;
      void layoutId;
      void onDragEnd;
      void onDragStart;
      void transition;
      return React.createElement(tag, { ...domProps, ref }, children as ReactNode);
    });
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: {
      button: passthrough("button"),
      span: passthrough("span"),
    },
  };
});

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) =>
      ({
        "app.pressPlay": "Press play",
        "nav.now": "Now playing",
        "player.loadingRemote": `Loading ${vars?.title ?? ""}`,
        "player.loadingTrack": `Preparing ${vars?.title ?? ""}`,
        "player.pause": "Pause",
        "player.play": "Play",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-media", () => ({
  useTrackCoverUrl: () => "https://cover.example/cover.jpg",
}));

vi.mock("@/components/ui/disc-3", () => ({
  Disc3Icon: ({ className }: { className?: string }) => (
    <span className={className} data-testid="disc-3-icon" />
  ),
}));

vi.mock("@/components/player/cover-image", () => ({
  CoverImage: ({ fallback, url }: { fallback?: ReactNode; url: string | null }) => (
    <div data-testid="cover-image" data-url={url ?? ""}>
      {fallback}
    </div>
  ),
}));

vi.mock("@/components/player/track-context-menu", () => ({
  CurrentTrackContextMenu: ({ children }: { children: ReactNode }) => (
    <div data-testid="track-context-menu">{children}</div>
  ),
}));

describe("TrackIdentityRow", () => {
  beforeEach(() => {
    usePlayerStore.setState({
      currentIndex: 0,
      isPlaying: false,
      playbackLoading: null,
      queue: [track("trk_current", "Current Song")],
    });
  });

  afterEach(() => {
    usePlayerStore.setState({
      currentIndex: -1,
      playbackLoading: null,
      queue: [],
    });
  });

  it("renders remote playback loading as a spinner over the dock cover", () => {
    usePlayerStore.setState({
      playbackLoading: {
        sourceKind: "remote",
        startedAt: 1,
        title: "Cloud Song",
        trackId: "trk_cloud",
      },
    });

    render(<TrackIdentityRow />);

    expect(screen.getByTestId("dock-cover-loading")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading Cloud Song" })).toBeInTheDocument();
  });

  it("does not render the cover spinner when playback is not preparing media", () => {
    render(<TrackIdentityRow />);

    expect(screen.queryByTestId("dock-cover-loading")).not.toBeInTheDocument();
  });
});

function track(id: string, title: string): Track {
  return {
    id,
    sessionId: "ses_1",
    title,
    kind: "audio",
    origin: "uploaded",
    provider: "upload",
    status: "ready",
    durationSec: 30,
    createdAt: 1,
    playCount: 0,
    liked: false,
    tags: [],
    remoteCoverUrl: "https://cover.example/cover.jpg",
  };
}

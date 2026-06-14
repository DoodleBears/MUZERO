import { act, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { NowPlayingBackground } from "./now-playing-background";

const mocks = vi.hoisted(() => ({
  coverResources: new Map<
    string,
    {
      readyForTrack: boolean;
      staleWhilePending: boolean;
      targetKey: string | null;
      url: string | null;
      urlKey: string | null;
    }
  >(),
  settings: {
    backgroundMode: "cover",
    flowEnabled: true,
    visualizerAsBackground: true,
    visualizerStyle: "bars",
    visualizerTuningByStyle: undefined,
  } as Partial<AppSettings>,
}));
const images: MockImage[] = [];
const OriginalImage = globalThis.Image;

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
  useTrackCoverResource: (track?: Track) => {
    const override = track ? mocks.coverResources.get(track.id) : undefined;
    if (override) return override;
    const url = track?.remoteCoverUrl ?? null;
    const key = url ? `remote:${url}` : (track?.coverBlobId ?? null);
    return {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: key,
      url,
      urlKey: url ? key : null,
    };
  },
  useTrackMediaUrl: () => null,
}));

vi.mock("@/visualizer/host", () => ({
  VisualizerHost: ({ style, styleId }: { style?: CSSProperties; styleId?: string }) => (
    <div data-style-id={styleId ?? "default"} data-testid="visualizer-host" style={style} />
  ),
}));

vi.mock("./pixi-pixel-background", () => ({
  PixiPixelBackground: ({
    className,
    mediaType,
    src,
  }: {
    className?: string;
    mediaType?: string;
    src: string | null;
  }) => (
    <div
      className={className}
      data-media-type={mediaType}
      data-src={src ?? ""}
      data-testid="pixi-background"
    />
  ),
}));

describe("NowPlayingBackground", () => {
  beforeEach(() => {
    Object.assign(mocks.settings, {
      backgroundGalleryFallback: undefined,
      backgroundMode: "cover",
      backgroundRenderer: undefined,
      flowEnabled: true,
      visualizerAsBackground: true,
      visualizerStyle: "bars",
      visualizerTuningByStyle: undefined,
    } satisfies Partial<AppSettings>);
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: MockImage,
    });
    images.length = 0;
    mocks.coverResources.clear();
    usePlayerStore.setState({
      currentIndex: -1,
      isPlaying: false,
      queue: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: OriginalImage,
    });
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

  it("applies per-style no-lyrics visualizer opacity to the background layer", () => {
    mocks.settings.visualizerTuningByStyle = {
      bars: {
        backgroundDim: 20,
        backgroundOpacity: 32,
      },
    };
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_current")],
    });

    render(<NowPlayingBackground active />);

    const visualizerHost = screen
      .getAllByTestId("visualizer-host")
      .find((node) => node.dataset.styleId === "default");

    expect(visualizerHost).toHaveStyle({ opacity: "0.32" });
  });

  it("does not keep the previous remote cover while the next remote cover is loading or failed", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "image";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [
        makeTrack("trk_a", { remoteCoverUrl: "https://img.example/a.jpg" }),
        makeTrack("trk_b", { remoteCoverUrl: "https://img.example/b.jpg" }),
      ],
    });
    const { container } = render(<NowPlayingBackground active />);

    await loadImage(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.example/a.jpg");

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(container.querySelector("img")).toBeNull();

    await failImage(1);
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not feed a stale previous cover resource into the background renderer", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "image";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.coverResources.set("trk_a", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_a",
      url: "blob:cover-a",
      urlKey: "blb_a",
    });
    mocks.coverResources.set("trk_b", {
      readyForTrack: false,
      staleWhilePending: true,
      targetKey: "blb_b",
      url: "blob:cover-a",
      urlKey: "blb_a",
    });
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [
        makeTrack("trk_a", { coverBlobId: "blb_a" }),
        makeTrack("trk_b", { coverBlobId: "blb_b" }),
      ],
    });
    const { container } = render(<NowPlayingBackground active />);

    await loadImage(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:cover-a");

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps the Pixi shell mounted but hidden while the next cover URL is pending", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.coverResources.set("trk_a", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_a",
      url: "blob:phase10-cover-a",
      urlKey: "blb_a",
    });
    mocks.coverResources.set("trk_b", {
      readyForTrack: false,
      staleWhilePending: true,
      targetKey: "blb_b",
      url: "blob:phase10-cover-a",
      urlKey: "blb_a",
    });
    const queue = [
      makeTrack("trk_a", { coverBlobId: "blb_a" }),
      makeTrack("trk_b", { coverBlobId: "blb_b", origin: "streamed" }),
    ];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);

    await loadImage(0);
    const firstShell = screen.getByTestId("pixi-background");
    expect(firstShell).toHaveAttribute("data-src", "blob:phase10-cover-a");
    expect(firstShell).toHaveClass("opacity-90");

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    const pendingShell = screen.getByTestId("pixi-background");
    expect(pendingShell).toBe(firstShell);
    expect(pendingShell).toHaveAttribute("data-src", "");
    expect(pendingShell).toHaveClass("opacity-0");

    mocks.coverResources.set("trk_b", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_b",
      url: "blob:phase10-cover-b",
      urlKey: "blb_b",
    });
    await act(async () => {
      usePlayerStore.setState({ queue: [...queue] });
      await Promise.resolve();
    });
    await loadImage(1);

    const readyShell = screen.getByTestId("pixi-background");
    expect(readyShell).toBe(firstShell);
    expect(readyShell).toHaveAttribute("data-src", "blob:phase10-cover-b");
    expect(readyShell).toHaveClass("opacity-90");
  });
});

function makeTrack(id: string, overrides?: Partial<Track>): Track {
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
    ...overrides,
  };
}

async function loadImage(index: number) {
  await act(async () => {
    images[index]?.onload?.(new Event("load"));
    await Promise.resolve();
  });
}

async function failImage(index: number) {
  await act(async () => {
    images[index]?.onerror?.(new Event("error"));
    await Promise.resolve();
  });
}

class MockImage {
  decoding = "";
  naturalHeight = 50;
  naturalWidth = 100;
  onerror: OnErrorEventHandler = null;
  onload: ((event: Event) => void) | null = null;
  referrerPolicy = "";
  src = "";

  constructor() {
    images.push(this);
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

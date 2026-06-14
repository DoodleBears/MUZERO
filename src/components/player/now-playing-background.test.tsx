import { act, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, Track } from "@/db/types";
import { clearTrace, getTraceEntries } from "@/lib/trace";
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
  coverDerivativeUrls: new Map<string, string | null>(),
  localCoverResources: new Map<
    string,
    {
      canServe: boolean | null;
      coverBlobId: string | null;
      pending: boolean;
      pendingReason: "row" | "url" | null;
      storageKey: string | null;
      url: string | null;
    }
  >(),
  settings: {
    backgroundMode: "cover",
    flowEnabled: true,
    visualizerAsBackground: true,
    visualizerStyle: "bars",
    visualizerTuningByStyle: undefined,
  } as Partial<AppSettings>,
  coverDerivativeCalls: [] as Array<{
    defer: boolean;
    kind: "backlight" | "thumbnail";
    trackId: string | undefined;
  }>,
  pixiSrcs: [] as string[],
  trackCoverResourceTrackIds: [] as Array<string | undefined>,
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

vi.mock("@/hooks/use-local-cover", () => ({
  useLocalCoverResource: (track?: Track) => {
    const override = track ? mocks.localCoverResources.get(track.id) : undefined;
    return {
      canServe: false,
      coverBlobId: track?.coverBlobId ?? null,
      pending: false,
      pendingReason: null,
      storageKey: null,
      url: null,
      ...override,
    };
  },
  useLocalCoverUrl: (track?: Track) => {
    const override = track ? mocks.localCoverResources.get(track.id) : undefined;
    return override?.url ?? null;
  },
}));

vi.mock("@/hooks/use-media", () => ({
  useCoverDerivativeUrl: (
    track: Track | undefined,
    kind: "backlight" | "thumbnail",
    options?: { defer?: boolean },
  ) => {
    mocks.coverDerivativeCalls.push({
      defer: options?.defer ?? false,
      kind,
      trackId: track?.id,
    });
    if (options?.defer) return null;
    if (!track) return null;
    return mocks.coverDerivativeUrls.get(`${track.id}:${kind}`) ?? null;
  },
  useObjectUrls: () => [],
  useTrackCoverResource: (track?: Track) => {
    mocks.trackCoverResourceTrackIds.push(track?.id);
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
  }) => {
    mocks.pixiSrcs.push(src ?? "");
    return (
      <div
        className={className}
        data-media-type={mediaType}
        data-src={src ?? ""}
        data-testid="pixi-background"
      />
    );
  },
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
    mocks.coverDerivativeUrls.clear();
    mocks.localCoverResources.clear();
    mocks.coverDerivativeCalls.length = 0;
    mocks.pixiSrcs.length = 0;
    mocks.trackCoverResourceTrackIds.length = 0;
    clearTrace();
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
    mocks.coverDerivativeUrls.set("trk_a:backlight", "blob:phase10-ambient-a");
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
    expect(firstShell).toHaveAttribute("data-src", "blob:phase10-ambient-a");
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
    mocks.coverDerivativeUrls.set("trk_b:backlight", "blob:phase10-ambient-b");
    await act(async () => {
      usePlayerStore.setState({ queue: [...queue] });
      await Promise.resolve();
    });
    await loadImage(1);

    const readyShell = screen.getByTestId("pixi-background");
    expect(readyShell).toBe(firstShell);
    expect(readyShell).toHaveAttribute("data-src", "blob:phase10-ambient-b");
    expect(readyShell).toHaveClass("opacity-90");
  });

  it("waits for a local protocol cover URL instead of decoding a blob fallback", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.localCoverResources.set("trk_local", {
      canServe: true,
      coverBlobId: "blb_local",
      pending: true,
      pendingReason: "url",
      storageKey: "cover/local.jpg",
      url: null,
    });
    mocks.coverResources.set("trk_local", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_local",
      url: "blob:should-not-decode",
      urlKey: "blb_local",
    });
    mocks.coverDerivativeUrls.set("trk_local:backlight", "blob:local-ambient");
    const queue = [makeTrack("trk_local", { coverBlobId: "blb_local", origin: "streamed" })];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);

    const pendingShell = screen.getByTestId("pixi-background");
    expect(pendingShell).toHaveAttribute("data-src", "");
    expect(pendingShell).toHaveClass("opacity-0");
    expect(mocks.trackCoverResourceTrackIds).not.toContain("trk_local");
    expect(images).toHaveLength(0);
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "localCover.wait",
          scope: "background.cover",
        }),
      ]),
    );

    mocks.localCoverResources.set("trk_local", {
      canServe: true,
      coverBlobId: "blb_local",
      pending: false,
      pendingReason: null,
      storageKey: "cover/local.jpg",
      url: "muzfetch://local-media/cover-token",
    });
    await act(async () => {
      usePlayerStore.setState({ queue: [...queue] });
      await Promise.resolve();
    });
    await loadImage(0);

    const readyShell = screen.getByTestId("pixi-background");
    expect(readyShell).toBe(pendingShell);
    expect(readyShell).toHaveAttribute("data-src", "blob:local-ambient");
    expect(readyShell).toHaveClass("opacity-90");
    expect(mocks.trackCoverResourceTrackIds).not.toContain("trk_local");
  });

  it("feeds a cover derivative into Pixi instead of the local original URL", () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.coverDerivativeUrls.set("trk_local:backlight", "blob:ambient-backlight");
    mocks.localCoverResources.set("trk_local", {
      canServe: true,
      coverBlobId: "blb_local",
      pending: false,
      pendingReason: null,
      storageKey: "cover/local.jpg",
      url: "muzfetch://local-media/original-cover",
    });
    const queue = [makeTrack("trk_local", { coverBlobId: "blb_local", origin: "streamed" })];
    usePlayerStore.setState({ currentIndex: 0, queue });

    render(<NowPlayingBackground active />);

    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "blob:ambient-backlight",
    );
    expect(mocks.coverDerivativeCalls).toContainEqual({
      defer: false,
      kind: "backlight",
      trackId: "trk_local",
    });
    expect(images).toHaveLength(0);
    expect(mocks.pixiSrcs).not.toContain("muzfetch://local-media/original-cover");
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "pixiCover.derivative",
          scope: "background.cover",
          context: expect.objectContaining({
            derivativeKind: "backlight",
            derivativeReady: true,
            fallbackToOriginal: false,
            phase: "success",
            trackId: "trk_local",
          }),
        }),
      ]),
    );
  });

  it("keeps Pixi hidden while the cover derivative is pending instead of falling back to the local original", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.localCoverResources.set("trk_local", {
      canServe: true,
      coverBlobId: "blb_local",
      pending: false,
      pendingReason: null,
      storageKey: "cover/local.jpg",
      url: "muzfetch://local-media/original-cover",
    });
    const queue = [makeTrack("trk_local", { coverBlobId: "blb_local", origin: "streamed" })];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);

    const shell = screen.getByTestId("pixi-background");
    expect(shell).toHaveAttribute("data-src", "");
    expect(shell).toHaveClass("opacity-0");
    expect(images).toHaveLength(0);
    expect(mocks.pixiSrcs).not.toContain("muzfetch://local-media/original-cover");
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "pixiCover.derivative",
          scope: "background.cover",
          context: expect.objectContaining({
            derivativeReady: false,
            derivativeState: "pending",
            fallbackToOriginal: false,
            phase: "state",
            trackId: "trk_local",
          }),
        }),
      ]),
    );
  });

  it("emits a local-cover fallback trace when the row cannot use the protocol URL", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.localCoverResources.set("trk_indexeddb", {
      canServe: false,
      coverBlobId: "blb_indexeddb",
      pending: false,
      pendingReason: null,
      storageKey: null,
      url: null,
    });
    mocks.coverResources.set("trk_indexeddb", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_indexeddb",
      url: "blob:indexeddb-cover",
      urlKey: "blb_indexeddb",
    });
    mocks.coverDerivativeUrls.set("trk_indexeddb:backlight", "blob:indexeddb-ambient");
    const queue = [makeTrack("trk_indexeddb", { coverBlobId: "blb_indexeddb" })];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);
    await loadImage(0);

    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "blob:indexeddb-ambient",
    );
    expect(getTraceEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "localCover.fallback",
          scope: "background.cover",
          context: expect.objectContaining({
            fallback: "object-url",
            reason: "unservable-row",
          }),
        }),
      ]),
    );
  });

  it("does not replay the previous settled Pixi target while a local cover URL is pending", async () => {
    mocks.settings.backgroundGalleryFallback = false;
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.coverResources.set("trk_prev", {
      readyForTrack: true,
      staleWhilePending: false,
      targetKey: "blb_prev",
      url: "blob:previous-cover",
      urlKey: "blb_prev",
    });
    mocks.coverDerivativeUrls.set("trk_prev:backlight", "blob:previous-ambient");
    mocks.localCoverResources.set("trk_local", {
      canServe: true,
      coverBlobId: "blb_local",
      pending: true,
      pendingReason: "url",
      storageKey: "cover/local.jpg",
      url: null,
    });
    const queue = [
      makeTrack("trk_prev", { coverBlobId: "blb_prev" }),
      makeTrack("trk_local", { coverBlobId: "blb_local", origin: "streamed" }),
    ];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);
    await loadImage(0);
    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "blob:previous-ambient",
    );

    mocks.pixiSrcs.length = 0;
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(screen.getByTestId("pixi-background")).toHaveAttribute("data-src", "");
    expect(mocks.pixiSrcs).not.toContain("blob:previous-ambient");
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

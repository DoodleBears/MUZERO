import { act, render, screen } from "@testing-library/react";
import type { CSSProperties } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, Track } from "@/db/types";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import { usePlayerStore } from "@/stores/player-store";
import { NowPlayingBackground, shouldRunBackgroundSlideshow } from "./now-playing-background";

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
  mediaEngine: null as null | {
    element: HTMLVideoElement;
    mount: ReturnType<typeof vi.fn>;
    unmount: ReturnType<typeof vi.fn>;
  },
  pixiSrcs: [] as string[],
  galleryRows: [] as Array<{ id: string }>,
  mediaBlobUrlRows: [] as Array<string | undefined>,
  trackBackgroundRows: [] as Array<{ id: string }>,
  trackCoverResourceTrackIds: [] as Array<string | undefined>,
}));
const images: MockImage[] = [];
const OriginalImage = globalThis.Image;
const originalMediaPlay = HTMLMediaElement.prototype.play;
const originalMediaPause = HTMLMediaElement.prototype.pause;

vi.mock("dexie-react-hooks", () => ({
  useLiveQuery: (query: () => unknown, _deps: unknown[], defaultValue: unknown) => {
    const result = query();
    return result instanceof Promise ? defaultValue : result;
  },
}));

vi.mock("@/db/repositories", () => ({
  getTrackLyrics: vi.fn(),
  listGalleryImageRows: () => mocks.galleryRows,
  listTrackBackgroundRows: () => mocks.trackBackgroundRows,
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
  useMediaBlobUrl: (row?: { id?: string } | null) => {
    mocks.mediaBlobUrlRows.push(row?.id);
    return row?.id ? `blob:background-${row.id}` : null;
  },
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
  useTrackMediaUrl: (track?: Track) => (track?.kind === "video" ? `blob:media-${track.id}` : null),
}));

vi.mock("@/stores/player-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/player-store")>();
  return {
    ...actual,
    getMediaEngine: () => mocks.mediaEngine,
  };
});

vi.mock("@/visualizer/host", () => ({
  VisualizerHost: ({ style, styleId }: { style?: CSSProperties; styleId?: string }) => (
    <div data-style-id={styleId ?? "default"} data-testid="visualizer-host" style={style} />
  ),
}));

vi.mock("./pixi-pixel-background", () => ({
  PixiPixelBackground: ({
    className,
    effect,
    mediaType,
    src,
  }: {
    className?: string;
    effect?: string;
    mediaType?: string;
    src: string | null;
  }) => {
    mocks.pixiSrcs.push(src ?? "");
    return (
      <div
        className={className}
        data-effect={effect}
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
      backgroundMaskBlur: undefined,
      backgroundMaskOpacity: undefined,
      backgroundMode: "cover",
      backgroundRenderer: undefined,
      flowEnabled: true,
      immersiveVideoTrackBackgroundEffectsEnabled: undefined,
      immersiveVideoTrackFlowEnabled: undefined,
      immersiveVideoTrackVisualizerEnabled: undefined,
      videoTrackBackgroundEffectsEnabled: undefined,
      videoTrackBackgroundMaskBlur: undefined,
      videoTrackBackgroundMaskOpacity: undefined,
      videoTrackFlowEnabled: undefined,
      videoTrackVisualizerEnabled: undefined,
      visualizerAsBackground: true,
      visualizerStyle: "bars",
      visualizerTuningByStyle: undefined,
    } satisfies Partial<AppSettings>);
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: MockImage,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: vi.fn(),
    });
    images.length = 0;
    mocks.coverResources.clear();
    mocks.coverDerivativeUrls.clear();
    mocks.galleryRows.length = 0;
    mocks.localCoverResources.clear();
    mocks.mediaBlobUrlRows.length = 0;
    const video = document.createElement("video");
    mocks.mediaEngine = {
      element: video,
      mount: vi.fn((container: HTMLElement) => container.appendChild(video)),
      unmount: vi.fn(),
    };
    mocks.coverDerivativeCalls.length = 0;
    mocks.pixiSrcs.length = 0;
    mocks.trackBackgroundRows.length = 0;
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
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: originalMediaPlay,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      configurable: true,
      value: originalMediaPause,
    });
    mocks.mediaEngine = null;
  });

  it("does not mount flow or visualizer effects when no current track is selected", () => {
    render(<NowPlayingBackground active />);

    expect(screen.queryByTestId("visualizer-host")).not.toBeInTheDocument();
  });

  it("runs slideshow timers only when the page is visible and there are multiple slides", () => {
    expect(shouldRunBackgroundSlideshow({ documentHidden: false, slideCount: 2 })).toBe(true);
    expect(shouldRunBackgroundSlideshow({ documentHidden: false, slideCount: 1 })).toBe(false);
    expect(shouldRunBackgroundSlideshow({ documentHidden: true, slideCount: 3 })).toBe(false);
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

  it("shows flow and visualizer on video tracks during normal playback by default", () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { kind: "video" })],
    });

    render(<NowPlayingBackground active />);

    const styleIds = screen.getAllByTestId("visualizer-host").map((node) => node.dataset.styleId);
    expect(styleIds).toContain("scene-flow");
    expect(styleIds).toContain("default");
  });

  it("can hide flow and visualizer on video tracks during normal playback", () => {
    mocks.settings.videoTrackFlowEnabled = false;
    mocks.settings.videoTrackVisualizerEnabled = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { kind: "video" })],
    });

    render(<NowPlayingBackground active />);

    expect(screen.queryByTestId("visualizer-host")).not.toBeInTheDocument();
  });

  it("hides flow and visualizer on video tracks while immersive by default", () => {
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { kind: "video" })],
    });

    render(<NowPlayingBackground active immersive />);

    expect(screen.queryByTestId("visualizer-host")).not.toBeInTheDocument();
  });

  it("can show flow and visualizer on video tracks while immersive", () => {
    mocks.settings.immersiveVideoTrackFlowEnabled = true;
    mocks.settings.immersiveVideoTrackVisualizerEnabled = true;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { kind: "video" })],
    });

    render(<NowPlayingBackground active immersive />);

    const styleIds = screen.getAllByTestId("visualizer-host").map((node) => node.dataset.styleId);
    expect(styleIds).toContain("scene-flow");
    expect(styleIds).toContain("default");
  });

  it("mounts the shared video backdrop and skips occluded Pixi during normal playback", () => {
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { blobId: "blb_video", kind: "video" })],
    });

    const { container } = render(<NowPlayingBackground active />);

    expect(screen.queryByTestId("pixi-background")).not.toBeInTheDocument();
    expect(mocks.mediaEngine?.mount).toHaveBeenCalledTimes(1);
    expect(container.querySelector("video")).toBe(mocks.mediaEngine?.element);
    expect(mocks.mediaEngine?.element).toHaveClass("object-cover");
  });

  it("skips Pixi blur when the shared video backdrop is active", () => {
    mocks.settings.backgroundRenderer = "blur";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { blobId: "blb_video", kind: "video" })],
    });

    render(<NowPlayingBackground active />);

    expect(screen.queryByTestId("pixi-background")).not.toBeInTheDocument();
    expect(mocks.mediaEngine?.mount).toHaveBeenCalledTimes(1);
  });

  it("uses a clean video background for immersive video tracks by default", () => {
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { blobId: "blb_video", kind: "video" })],
    });

    const { container } = render(<NowPlayingBackground active immersive />);

    expect(screen.queryByTestId("pixi-background")).not.toBeInTheDocument();
    expect(container.querySelector("video")).toBe(mocks.mediaEngine?.element);
    expect(mocks.mediaEngine?.mount).toHaveBeenCalledTimes(1);
  });

  it("still skips selected background effects on immersive video tracks when the backdrop covers them", () => {
    mocks.settings.backgroundRenderer = "noise";
    mocks.settings.flowEnabled = false;
    mocks.settings.immersiveVideoTrackBackgroundEffectsEnabled = true;
    mocks.settings.visualizerAsBackground = false;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { blobId: "blb_video", kind: "video" })],
    });

    render(<NowPlayingBackground active immersive />);

    expect(screen.queryByTestId("pixi-background")).not.toBeInTheDocument();
    expect(mocks.mediaEngine?.mount).toHaveBeenCalledTimes(1);
  });

  it("uses video-track dim and blur settings for video backgrounds", () => {
    mocks.settings.backgroundMaskOpacity = 10;
    mocks.settings.backgroundMaskBlur = 3;
    mocks.settings.videoTrackBackgroundMaskOpacity = 64;
    mocks.settings.videoTrackBackgroundMaskBlur = 12;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_video", { kind: "video" })],
    });

    render(<NowPlayingBackground active />);

    expect(screen.getByTestId("background-mask")).toHaveStyle({ opacity: "0.64" });
    expect(screen.getByTestId("background-mask-blur")).toHaveStyle({
      backdropFilter: "blur(12px)",
    });
  });

  it("resolves only the active gallery slideshow row instead of every gallery blob", async () => {
    mocks.settings.backgroundMode = "cover";
    mocks.settings.flowEnabled = false;
    mocks.settings.visualizerAsBackground = false;
    mocks.galleryRows.push({ id: "gal_a" }, { id: "gal_b" }, { id: "gal_c" });
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_without_cover")],
    });

    render(<NowPlayingBackground active />);
    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.mediaBlobUrlRows).toContain("gal_a");
    expect(mocks.mediaBlobUrlRows).toContain("gal_c");
    expect(mocks.mediaBlobUrlRows).not.toContain("gal_b");
    expect(new Set(mocks.mediaBlobUrlRows.filter(Boolean))).toEqual(new Set(["gal_a", "gal_c"]));
  });

  it("keeps global dim and blur settings for non-video backgrounds", () => {
    mocks.settings.backgroundMaskOpacity = 10;
    mocks.settings.backgroundMaskBlur = 3;
    mocks.settings.videoTrackBackgroundMaskOpacity = 64;
    mocks.settings.videoTrackBackgroundMaskBlur = 12;
    usePlayerStore.setState({
      currentIndex: 0,
      queue: [makeTrack("trk_audio", { kind: "audio" })],
    });

    render(<NowPlayingBackground active />);

    expect(screen.getByTestId("background-mask")).toHaveStyle({ opacity: "0.1" });
    expect(screen.getByTestId("background-mask-blur")).toHaveStyle({
      backdropFilter: "blur(3px)",
    });
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

    const firstShell = screen.getByTestId("pixi-background");
    expect(firstShell).toHaveAttribute("data-src", "blob:phase10-cover-a");
    expect(firstShell).toHaveClass("opacity-100");
    expect(images).toHaveLength(0);

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

    const readyShell = screen.getByTestId("pixi-background");
    expect(readyShell).toBe(firstShell);
    expect(readyShell).toHaveAttribute("data-src", "blob:phase10-cover-b");
    expect(readyShell).toHaveClass("opacity-100");
    expect(images).toHaveLength(0);
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

    const readyShell = screen.getByTestId("pixi-background");
    expect(readyShell).toBe(pendingShell);
    expect(readyShell).toHaveAttribute("data-src", "muzfetch://local-media/cover-token");
    expect(readyShell).toHaveClass("opacity-100");
    expect(mocks.trackCoverResourceTrackIds).not.toContain("trk_local");
    expect(images).toHaveLength(0);
  });

  it("feeds the ORIGINAL local cover URL into Pixi (no 192px backlight derivative)", async () => {
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

    // The Pixi background now renders the ORIGINAL cover (GPU-scaled), not a cropped
    // 192px derivative — so the cover derivative hook is never invoked for it.
    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "muzfetch://local-media/original-cover",
    );
    expect(mocks.pixiSrcs).toContain("muzfetch://local-media/original-cover");
    expect(mocks.coverDerivativeCalls).toHaveLength(0);
    expect(images).toHaveLength(0);
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
    const queue = [makeTrack("trk_indexeddb", { coverBlobId: "blb_indexeddb" })];
    usePlayerStore.setState({ currentIndex: 0, queue });
    render(<NowPlayingBackground active />);

    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "blob:indexeddb-cover",
    );
    expect(images).toHaveLength(0);
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
    expect(screen.getByTestId("pixi-background")).toHaveAttribute(
      "data-src",
      "blob:previous-cover",
    );
    expect(images).toHaveLength(0);

    mocks.pixiSrcs.length = 0;
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(screen.getByTestId("pixi-background")).toHaveAttribute("data-src", "");
    expect(mocks.pixiSrcs).not.toContain("blob:previous-cover");
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

import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { SwipeableMediaStage } from "./swipeable-media-stage";

const mocks = vi.hoisted(() => ({
  coverReadyForTrack: true,
  mediaStageProps: [] as Array<{
    coverBacklightEnabled?: boolean;
    coverBacklightFadeIn?: boolean;
  }>,
  motionProps: [] as Array<Record<string, unknown>>,
  objectUrlIndex: 0,
}));

vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MotionDiv = React.forwardRef<HTMLDivElement, Record<string, unknown>>((props, ref) => {
    mocks.motionProps.push(props);
    const {
      animate,
      children,
      drag,
      dragConstraints,
      dragElastic,
      dragMomentum,
      initial,
      style,
      transition,
      ...domProps
    } = props;
    void animate;
    void drag;
    void dragConstraints;
    void dragElastic;
    void dragMomentum;
    void initial;
    void style;
    void transition;
    return React.createElement("div", { ...domProps, ref }, children as React.ReactNode);
  });
  // A stable, stateful motion value so the wheel handler can read x.get()/set().
  let motionValue = 0;
  const x = {
    get: () => motionValue,
    set: (next: number) => {
      motionValue = next;
    },
  };
  return {
    animate: () => {
      const controls = Promise.resolve() as Promise<void> & { stop: () => void };
      controls.stop = vi.fn();
      return controls;
    },
    motion: {
      div: MotionDiv,
    },
    motionValue: (initial = 0) => {
      let value = initial;
      return {
        get: () => value,
        set: (next: number) => {
          value = next;
        },
        on: () => () => {},
      };
    },
    useMotionValue: () => x,
    useMotionValueEvent: () => {},
    useTransform: () => 0,
  };
});

vi.mock("react-i18next", () => ({
  initReactI18next: {
    init: () => undefined,
    type: "3rdParty",
  },
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "player.next": "Next",
        "player.previous": "Previous",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/use-app-data", () => ({
  useSettings: () => ({ coverCropped: true }),
}));

vi.mock("@/hooks/use-media", () => ({
  useCoverDerivativeUrl: () => "blob:backlight",
  useTrackCoverUrl: () => null,
  useTrackCoverResource: () => ({
    readyForTrack: mocks.coverReadyForTrack,
    staleWhilePending: !mocks.coverReadyForTrack,
    targetKey: "blb_current",
    url: mocks.coverReadyForTrack ? "blob:current" : "blob:stale-previous",
    urlKey: mocks.coverReadyForTrack ? "blb_current" : "blb_previous",
  }),
  proxyExternalCover: (url: string | undefined) => url ?? null,
}));

vi.mock("@/db/media-blob-storage", () => ({
  resolveMediaBlob: async (id: string) => ({
    blob: new Blob([id], { type: "image/png" }),
    bytes: id.length,
    id,
    mime: "image/png",
    role: "cover",
  }),
}));

vi.mock("./media-stage", () => ({
  MediaStage: (props: { coverBacklightEnabled?: boolean; coverBacklightFadeIn?: boolean }) => {
    mocks.mediaStageProps.push(props);
    return <div data-testid="media-stage" />;
  },
}));

vi.mock("./stage-title-fallback", () => ({
  StageTitleFallback: ({ track }: { track?: Track }) => (
    <div data-testid={track ? `visual-${track.id}` : "visual-empty"} />
  ),
}));

describe("SwipeableMediaStage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.coverReadyForTrack = true;
    mocks.mediaStageProps = [];
    mocks.motionProps = [];
    mocks.objectUrlIndex = 0;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => `blob:preload-${++mocks.objectUrlIndex}`),
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
      writable: true,
    });
    Object.defineProperty(global, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
      writable: true,
    });
    const queue = [makeTrack("trk_a"), makeTrack("trk_b"), makeTrack("trk_c")];
    usePlayerStore.setState({
      currentIndex: 0,
      next: async () => {
        usePlayerStore.setState({ currentIndex: 1 });
      },
      peekTrack: (direction) => {
        const state = usePlayerStore.getState();
        const offset = direction === "next" ? 1 : -1;
        return state.queue[state.currentIndex + offset];
      },
      queue,
      skipPrev: async () => {
        usePlayerStore.setState({ currentIndex: 0 });
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears stale swipe overlays when another control changes the current track", async () => {
    render(<SwipeableMediaStage />);

    await act(async () => {
      latestDragProps().onPointerDown?.({});
    });
    await act(async () => {
      latestDragProps().onDrag?.({}, { offset: { x: -24 }, velocity: { x: 0 } });
    });
    await act(async () => {
      latestDragProps().onDragEnd?.({}, { offset: { x: -120 }, velocity: { x: 0 } });
      await Promise.resolve();
    });

    expect(screen.getAllByTestId("visual-trk_b").length).toBeGreaterThan(0);

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 2 });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("visual-trk_b")).not.toBeInTheDocument();
    expect(screen.getByTestId("media-stage")).toBeInTheDocument();
  });

  it("commits a short drag when released as a fast fling (Transition Driver path)", async () => {
    render(<SwipeableMediaStage />);

    await act(async () => {
      latestDragProps().onPointerDown?.({});
    });
    await act(async () => {
      latestDragProps().onDrag?.({}, { offset: { x: -24 }, velocity: { x: -900 } });
    });
    // Below the distance threshold, but a fling faster than COMMIT_VELOCITY in the
    // drag direction must still commit — exercising shouldCommitRelease's fling arm.
    await act(async () => {
      latestDragProps().onDragEnd?.({}, { offset: { x: -24 }, velocity: { x: -900 } });
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("switches to the next track on a horizontal trackpad swipe", async () => {
    render(<SwipeableMediaStage />);
    // container (wheel target) = cover box wrapping the draggable stage.
    const container = screen.getByTestId("media-stage").parentElement?.parentElement;
    if (!container) throw new Error("Missing stage container");

    await act(async () => {
      // deltaX > 0, no vertical component → a leftward swipe = "next".
      container.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 140, deltaY: 0 }),
      );
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().currentIndex).toBe(1);
  });

  it("ignores vertical wheel scrolling", async () => {
    render(<SwipeableMediaStage />);
    const container = screen.getByTestId("media-stage").parentElement?.parentElement;
    if (!container) throw new Error("Missing stage container");

    await act(async () => {
      container.dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 4, deltaY: 120 }),
      );
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().currentIndex).toBe(0);
  });

  it("uses the moving overlay backlight during a cancelled drag, then restores the base", async () => {
    render(<SwipeableMediaStage />);

    expect(mocks.mediaStageProps.at(-1)?.coverBacklightEnabled).toBe(true);
    // Default settings match the "quality" preset → rich switch transitions → the base
    // cover backlight fades in (balanced/battery would pop with fadeIn=false).
    expect(mocks.mediaStageProps.at(-1)?.coverBacklightFadeIn).toBe(true);

    await act(async () => {
      latestDragProps().onPointerDown?.({});
    });
    await act(async () => {
      latestDragProps().onDrag?.({}, { offset: { x: -24 }, velocity: { x: 0 } });
    });

    expect(mocks.mediaStageProps.at(-1)?.coverBacklightEnabled).toBe(false);

    await act(async () => {
      latestDragProps().onDragEnd?.({}, { offset: { x: -24 }, velocity: { x: 0 } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(usePlayerStore.getState().currentIndex).toBe(0);
    expect(mocks.mediaStageProps.at(-1)?.coverBacklightEnabled).toBe(true);
  });

  it("hides stage backlight and coverflow overlays when the foreground is hidden", async () => {
    render(<SwipeableMediaStage foregroundVisible={false} />);

    expect(mocks.mediaStageProps.at(-1)?.coverBacklightEnabled).toBe(false);

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("visual-trk_b")).not.toBeInTheDocument();
    expect(mocks.mediaStageProps.at(-1)?.coverBacklightEnabled).toBe(false);
  });

  it("plays the coverflow for an external switch (button / Q-E / auto-advance)", async () => {
    render(<SwipeableMediaStage />);

    // No gesture — the store just advances, as a transport button or shortcut
    // would do. The stage should detect it and animate the same coverflow.
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    // The incoming track settles through the overlay (not an instant swap).
    expect(screen.getAllByTestId("visual-trk_b").length).toBeGreaterThan(0);
  });

  it("skips the coverflow during a rapid burst and lets the base stage carry it (Phase 29)", async () => {
    render(<SwipeableMediaStage />);

    // First switch after an idle gap animates the coverflow (incoming card mounts).
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });
    expect(screen.getAllByTestId("visual-trk_b").length).toBeGreaterThan(0);

    // A second switch in the same instant (no time advanced) is part of a burst:
    // no coverflow overlay for the skipped song — the base MediaStage carries it.
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 2 });
      await Promise.resolve();
    });
    expect(screen.queryByTestId("visual-trk_c")).not.toBeInTheDocument();
    expect(screen.getByTestId("media-stage")).toBeInTheDocument();
  });

  it("keeps the settled overlay visible while the base stage still reports a stale previous cover", async () => {
    const queue = [
      makeTrack("trk_b", { coverBlobId: "blb_b" }),
      makeTrack("trk_a", { coverBlobId: "blb_a" }),
    ];
    usePlayerStore.setState({
      currentIndex: 1,
      peekTrack: (direction) => {
        const state = usePlayerStore.getState();
        const offset = direction === "next" ? 1 : -1;
        return state.queue[state.currentIndex + offset];
      },
      queue,
      skipPrev: async () => {
        usePlayerStore.setState({ currentIndex: 0 });
      },
    });
    render(<SwipeableMediaStage />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await Promise.resolve();
    });

    mocks.coverReadyForTrack = false;
    await act(async () => {
      usePlayerStore.setState({ currentIndex: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelectorAll('img[src^="blob:preload-"]').length).toBeGreaterThan(0);

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
    });

    expect(document.querySelectorAll('img[src^="blob:preload-"]').length).toBeGreaterThan(0);
  });

  it("never shows a bare title card for a streamed track switch (remote cover preloads)", async () => {
    // A streamed track keeps its art in `remoteCoverUrl` with no local blob. Its
    // proxied URL is preloaded into the coverflow strip, so the incoming card
    // paints the cover <img> — never the title-card fallback (whether the
    // coverflow plays or the base MediaStage crossfade takes it).
    const streamed = [
      makeTrack("trk_s1", { coverBlobId: undefined, remoteCoverUrl: "https://x/1.jpg" }),
      makeTrack("trk_s2", { coverBlobId: undefined, remoteCoverUrl: "https://x/2.jpg" }),
    ];
    usePlayerStore.setState({ currentIndex: 0, queue: streamed });
    render(<SwipeableMediaStage />);

    await act(async () => {
      usePlayerStore.setState({ currentIndex: 1 });
      await Promise.resolve();
    });

    expect(screen.queryByTestId("visual-trk_s2")).not.toBeInTheDocument();
    expect(screen.getByTestId("media-stage")).toBeInTheDocument();
  });
});

function latestDragProps() {
  const props = mocks.motionProps.findLast((p) => p.drag === "x");
  if (!props) throw new Error("Missing draggable motion props");
  return props as {
    onDrag?: (event: unknown, info: { offset: { x: number }; velocity: { x: number } }) => void;
    onDragEnd?: (event: unknown, info: { offset: { x: number }; velocity: { x: number } }) => void;
    onPointerDown?: (event: unknown) => void;
  };
}

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
    title: id,
    ...overrides,
  };
}

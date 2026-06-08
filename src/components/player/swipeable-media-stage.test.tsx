import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "@/db/types";
import { usePlayerStore } from "@/stores/player-store";
import { SwipeableMediaStage } from "./swipeable-media-stage";

const mocks = vi.hoisted(() => ({
  motionProps: [] as Array<Record<string, unknown>>,
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
  return {
    animate: () => {
      const controls = Promise.resolve() as Promise<void> & { stop: () => void };
      controls.stop = vi.fn();
      return controls;
    },
    motion: {
      div: MotionDiv,
    },
    useMotionValue: () => ({ set: vi.fn() }),
    useReducedMotion: () => false,
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
  useTrackCoverUrl: () => null,
}));

vi.mock("./media-stage", () => ({
  MediaStage: () => <div data-testid="media-stage" />,
}));

vi.mock("./stage-title-fallback", () => ({
  StageTitleFallback: ({ track }: { track?: Track }) => (
    <div data-testid={track ? `visual-${track.id}` : "visual-empty"} />
  ),
}));

describe("SwipeableMediaStage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.motionProps = [];
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
    title: id,
  };
}

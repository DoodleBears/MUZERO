import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryTimelineCarouselIntervalMs } from "@/lib/memory-timeline";
import { MemoryTimelineRail, type MemoryTimelineRailItem } from "./memory-timeline-rail";

const memories: MemoryTimelineRailItem[] = [
  { id: "mem_first", trackId: "trk_a", note: "First subway listen", createdAt: 10 },
  {
    id: "mem_second",
    trackId: "trk_b",
    note: "Second kitchen loop",
    createdAt: 20,
    photoUrl: "blob:memory-second",
  },
  { id: "mem_third", trackId: "trk_c", note: "Third late walk", createdAt: 30 },
];

function renderRail(props: Partial<React.ComponentProps<typeof MemoryTimelineRail>> = {}) {
  return render(
    <MemoryTimelineRail
      carouselIntervalMs={1000}
      formatCreatedAt={(createdAt) => `time-${createdAt}`}
      idleDelayMs={500}
      labels={{ empty: "No memories yet", memory: "Memory" }}
      memories={memories}
      timelineItemHeight={100}
      {...props}
    />,
  );
}

describe("MemoryTimelineRail", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the idle carousel from the persisted scroll position", () => {
    renderRail({ initialOffset: 100 });

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Second kitchen loop");
    expect(screen.getByTestId("memory-carousel-card")).not.toHaveTextContent("Kitchen Song");
    expect(screen.getByTestId("memory-carousel-card")).toHaveClass("w-4/5");
    expect(screen.getByTestId("memory-carousel-note")).toHaveStyle({
      fontSize: "64px",
      lineHeight: "72px",
    });
    expect(screen.getByTestId("memory-carousel-note")).not.toHaveClass("line-clamp-9");
    expect(screen.getByTestId("memory-carousel-card")).toHaveAttribute(
      "data-transition",
      "crossfade",
    );
    expect(screen.getByTestId("memory-carousel-card")).toHaveClass("grid");
    expect(screen.getByTestId("memory-carousel-image")).toHaveClass("object-contain");
    expect(screen.getByTestId("memory-carousel-image")).toHaveClass("max-h-[min(52vh,24rem)]");
    expect(screen.getByTestId("memory-timeline-rail")).not.toHaveClass("bg-card/55");
    expect(screen.getByTestId("memory-carousel-stage")).toHaveClass("place-items-center");

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Third late walk");
  });

  it("keeps longer memory notes on screen for a longer capped dwell time", () => {
    const longNote = "x".repeat(70);
    const dwellMs = memoryTimelineCarouselIntervalMs(longNote, { baseMs: 1000 });
    renderRail({
      carouselIntervalMs: 1000,
      memories: [
        { id: "mem_long", trackId: "trk_a", note: longNote, createdAt: 10 },
        { id: "mem_next", trackId: "trk_a", note: "next memory", createdAt: 20 },
      ],
    });

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent(longNote);

    act(() => vi.advanceTimersByTime(dwellMs - 999));
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("next memory");
  });

  it("shows a lyrics-style vertical timeline on interaction, stores drag offset, then resumes idle from that node", () => {
    const onOffsetChange = vi.fn();
    renderRail({ onOffsetChange });

    const rail = screen.getByTestId("memory-timeline-rail");
    fireEvent.wheel(rail);
    expect(screen.queryByTestId("memory-playhead-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("memory-timeline-playhead")).not.toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-list")).toHaveClass("flex-col");
    expect(screen.getByTestId("memory-timeline-image-mem_second")).toHaveClass("object-contain");

    const scrubber = screen.getByTestId("memory-timeline-scrubber");
    fireEvent.pointerDown(scrubber, { clientY: 240, pointerId: 1 });
    fireEvent.pointerMove(scrubber, { buttons: 1, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(scrubber, { pointerId: 1 });

    expect(onOffsetChange).toHaveBeenLastCalledWith(200);
    expect(screen.getByTestId("memory-timeline-item-mem_third")).toHaveAttribute(
      "data-active",
      "true",
    );

    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Third late walk");
  });

  it("starts dragging on the same pointer gesture that leaves the idle carousel", () => {
    const onOffsetChange = vi.fn();
    renderRail({ onOffsetChange });

    const rail = screen.getByTestId("memory-timeline-rail");
    fireEvent.pointerDown(rail, { clientY: 240, pointerId: 1 });
    expect(rail).toHaveAttribute("data-mode", "timeline");
    expect(screen.queryByTestId("memory-carousel-card")).not.toBeInTheDocument();

    fireEvent.pointerMove(rail, { buttons: 1, clientY: 40, pointerId: 1 });
    fireEvent.pointerUp(rail, { pointerId: 1 });

    expect(onOffsetChange).toHaveBeenLastCalledWith(200);
    expect(screen.getByTestId("memory-timeline-item-mem_third")).toHaveAttribute(
      "data-active",
      "true",
    );
  });

  it("renders an empty state when there are no memories", () => {
    renderRail({ memories: [] });

    expect(screen.queryByText("No memories yet")).not.toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-rail")).toBeEmptyDOMElement();
    expect(screen.queryByTestId("memory-carousel-card")).not.toBeInTheDocument();
  });
});

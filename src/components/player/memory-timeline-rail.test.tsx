import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTimelineRail, type MemoryTimelineRailItem } from "./memory-timeline-rail";

const memories: MemoryTimelineRailItem[] = [
  { id: "mem_first", trackId: "trk_a", note: "First subway listen", createdAt: 10 },
  {
    id: "mem_second",
    trackId: "trk_b",
    note: "Second kitchen loop",
    createdAt: 20,
    trackTitle: "Kitchen Song",
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
      timelineItemWidth={100}
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
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Kitchen Song");
    expect(screen.getByTestId("memory-timeline-rail")).not.toHaveClass("bg-card/55");
    expect(screen.getByTestId("memory-carousel-stage")).toHaveClass("place-items-center");

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Third late walk");
  });

  it("shows a playhead timeline on interaction, stores drag offset, then resumes idle from that node", () => {
    const onOffsetChange = vi.fn();
    renderRail({ onOffsetChange });

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));
    expect(screen.getByTestId("memory-timeline-playhead")).toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();

    const scrubber = screen.getByTestId("memory-timeline-scrubber");
    fireEvent.pointerDown(scrubber, { clientX: 240, pointerId: 1 });
    fireEvent.pointerMove(scrubber, { buttons: 1, clientX: 40, pointerId: 1 });
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

  it("renders an empty state when there are no memories", () => {
    renderRail({ memories: [] });

    expect(screen.getByText("No memories yet")).toBeInTheDocument();
    expect(screen.queryByTestId("memory-carousel-card")).not.toBeInTheDocument();
  });
});

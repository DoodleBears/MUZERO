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
    renderRail({ initialScrollTop: 100 });

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Second kitchen loop");
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Kitchen Song");

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Third late walk");
  });

  it("shows a timeline on interaction, stores scrollTop, then resumes idle from that node", () => {
    const onScrollTopChange = vi.fn();
    renderRail({ onScrollTopChange });

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();

    fireEvent.scroll(screen.getByTestId("memory-timeline-scroll"), {
      target: { scrollTop: 200 },
    });

    expect(onScrollTopChange).toHaveBeenLastCalledWith(200);
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

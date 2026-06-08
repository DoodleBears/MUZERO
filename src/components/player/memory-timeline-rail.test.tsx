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
    photoUrl: "blob:memory-second",
  },
  { id: "mem_third", trackId: "trk_c", note: "Third late walk", createdAt: 30 },
];

function renderRail(props: Partial<React.ComponentProps<typeof MemoryTimelineRail>> = {}) {
  return render(
    <MemoryTimelineRail
      carouselIntervalMs={1000}
      formatCreatedAt={(createdAt) => `time-${createdAt}`}
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

  it("renders only the motion carousel and advances memories", async () => {
    renderRail();
    await act(async () => {});

    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "carousel");
    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("First subway listen");
    expect(screen.getByTestId("memory-carousel-card")).toHaveAttribute(
      "data-transition",
      "exit-wait-layout-ready",
    );
    expect(screen.getByTestId("memory-carousel-stage")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("memory-carousel-stage")).toHaveClass(
      "transition-opacity",
      "opacity-100",
    );
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("memory-timeline-list")).toHaveClass(
      "transition-opacity",
      "opacity-0",
      "pointer-events-none",
    );
    expect(screen.queryByTestId("memory-timeline-scrubber")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Second kitchen loop");
    expect(screen.getByTestId("memory-carousel-image")).toHaveClass("object-contain");
  });

  it("switches to the pretext masonry memory wall on mouse wheel", async () => {
    renderRail();
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));

    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "list");
    expect(screen.getByTestId("memory-carousel-stage")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("memory-carousel-stage")).toHaveClass(
      "transition-opacity",
      "opacity-0",
      "pointer-events-none",
    );
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("memory-timeline-list")).toHaveClass(
      "transition-opacity",
      "opacity-100",
    );
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-layout", "masonry");
    const masonryItems = screen.getAllByRole("listitem");
    expect(masonryItems).toHaveLength(3);
    expect(masonryItems[0]).toHaveAttribute("data-memory-masonry-id", "mem_third");
    expect(screen.getByTestId("memory-timeline-list").querySelector("ul")).toHaveClass(
      "min-h-full",
    );
    expect(screen.getByText("Second kitchen loop")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Memory" })).toHaveClass("object-contain");
    expect(
      screen.getByTestId("memory-timeline-list").querySelector("[data-memory-masonry-id]"),
    ).not.toHaveAttribute("data-index");
  });

  it("does not mount TanStack virtual rows in the memory wall", async () => {
    renderRail();
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));

    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-layout", "masonry");
    expect(screen.queryByTestId("memory-timeline-item-mem_first")).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem").map((item) => item.dataset.memoryMasonryId)).toEqual([
      "mem_third",
      "mem_second",
      "mem_first",
    ]);
  });

  it("keeps the masonry memory wall as a normal scroll surface", async () => {
    const onOffsetChange = vi.fn();
    renderRail({ onOffsetChange });
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));

    const list = screen.getByTestId("memory-timeline-list");
    Object.defineProperties(list, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
      scrollTop: { configurable: true, value: 20, writable: true },
    });
    fireEvent.wheel(list, { deltaY: 40 });

    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "list");

    list.scrollTop = 200;
    fireEvent.scroll(list);

    expect(onOffsetChange).toHaveBeenLastCalledWith(200);
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-offset", "200");
  });

  it("returns from the masonry wall to carousel after the idle delay", async () => {
    renderRail({ idleDelayMs: 500 });
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));
    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "list");

    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "carousel");
    expect(screen.getByTestId("memory-carousel-card")).toBeInTheDocument();
    expect(screen.getByTestId("memory-carousel-stage")).toHaveAttribute("data-visible", "true");
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute("data-visible", "false");
  });

  it("starts the carousel from the persisted offset", async () => {
    renderRail({ initialOffset: 200 });
    await act(async () => {});

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Third late walk");
  });

  it("renders an empty rail when there are no memories", () => {
    renderRail({ memories: [] });

    expect(screen.getByTestId("memory-timeline-rail")).toBeEmptyDOMElement();
    expect(screen.queryByTestId("memory-carousel-card")).not.toBeInTheDocument();
  });
});

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryTimelineRail, type MemoryTimelineRailItem } from "./memory-timeline-rail";

const useVirtualizerMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number; estimateSize: (index: number) => number }) =>
    useVirtualizerMock(options),
}));

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
  if (!useVirtualizerMock.getMockImplementation()) {
    useVirtualizerMock.mockImplementation(
      (options: { count: number; estimateSize: (index: number) => number }) => {
        const sizes = Array.from({ length: options.count }, (_, index) =>
          options.estimateSize(index),
        );
        return {
          getTotalSize: () => sizes.reduce((total, size) => total + size, 0),
          getVirtualItems: () => {
            let start = 0;
            return sizes.map((size, index) => {
              const item = { index, key: index, size, start };
              start += size;
              return item;
            });
          },
        };
      },
    );
  }

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
    useVirtualizerMock.mockReset();
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
    expect(screen.queryByTestId("memory-timeline-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("memory-timeline-scrubber")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));

    expect(screen.getByTestId("memory-carousel-card")).toHaveTextContent("Second kitchen loop");
    expect(screen.getByTestId("memory-carousel-image")).toHaveClass("object-contain");
  });

  it("switches to the fixed-size virtual memory list on mouse wheel", async () => {
    renderRail();
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));

    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "list");
    expect(screen.queryByTestId("memory-carousel-card")).not.toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-list")).toHaveAttribute(
      "data-virtualized",
      "fixed-size",
    );
    expect(screen.getByTestId("memory-timeline-item-mem_first")).toHaveAttribute("data-index", "0");
    expect(screen.getByTestId("memory-timeline-item-mem_first").style.height).toBe("100px");
    expect(screen.getByTestId("memory-timeline-note-mem_second")).toHaveTextContent(
      "Second kitchen loop",
    );
    expect(screen.getByTestId("memory-timeline-image-mem_second")).toHaveClass("object-contain");
    expect(useVirtualizerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        estimateSize: expect.any(Function),
        getItemKey: expect.any(Function),
        overscan: 8,
      }),
    );
  });

  it("keeps wheel events in the virtual memory list as list activity until a boundary pull threshold", async () => {
    const onPullPastEnd = vi.fn();
    const onPullPastStart = vi.fn();
    renderRail({ onPullPastEnd, onPullPastStart });
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
    expect(onPullPastEnd).not.toHaveBeenCalled();

    list.scrollTop = 200;

    fireEvent.wheel(list, { deltaY: 48 });
    expect(list.firstElementChild).toHaveAttribute("data-edge-pull", "-22");
    expect(onPullPastEnd).not.toHaveBeenCalled();

    fireEvent.wheel(list, { deltaY: 48 });
    expect(onPullPastEnd).toHaveBeenCalledTimes(1);

    list.scrollTop = 0;

    fireEvent.wheel(list, { deltaY: -48 });
    expect(list.firstElementChild).toHaveAttribute("data-edge-pull", "22");
    expect(onPullPastStart).not.toHaveBeenCalled();

    fireEvent.wheel(list, { deltaY: -48 });
    expect(onPullPastStart).toHaveBeenCalledTimes(1);
  });

  it("keeps memory rows visible before the virtualizer has measured the scroll element", async () => {
    useVirtualizerMock.mockReturnValue({
      getTotalSize: () => 0,
      getVirtualItems: () => [],
    });

    renderRail();
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));

    expect(screen.getByTestId("memory-timeline-list").firstElementChild).toHaveStyle({
      height: "300px",
    });
    expect(screen.getByTestId("memory-timeline-item-mem_first")).toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-item-mem_second")).toBeInTheDocument();
    expect(screen.getByTestId("memory-timeline-item-mem_third")).toBeInTheDocument();
  });

  it("returns from the virtual list to carousel after the idle delay", async () => {
    renderRail({ idleDelayMs: 500 });
    await act(async () => {});

    fireEvent.wheel(screen.getByTestId("memory-timeline-rail"));
    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "list");

    act(() => vi.advanceTimersByTime(499));
    expect(screen.getByTestId("memory-timeline-list")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("memory-timeline-rail")).toHaveAttribute("data-mode", "carousel");
    expect(screen.getByTestId("memory-carousel-card")).toBeInTheDocument();
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

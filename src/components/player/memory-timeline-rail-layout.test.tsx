import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemoryTimelineRail, type MemoryTimelineRailItem } from "./memory-timeline-rail";

const labels = { empty: "No memories yet", memory: "Memory" };

function renderRail(memories: MemoryTimelineRailItem[]) {
  return render(
    <MemoryTimelineRail
      formatCreatedAt={(createdAt) => `time-${createdAt}`}
      labels={labels}
      memories={memories}
    />,
  );
}

describe("MemoryTimelineRail layout-ready fade", () => {
  it("waits for memory photos to load before fading in fitted text", async () => {
    renderRail([
      {
        createdAt: 10,
        id: "mem_photo",
        note: "Photo memory should not fade in until media affects layout",
        photoUrl: "blob:memory-photo",
        trackId: "trk_a",
      },
    ]);

    expect(screen.getByTestId("memory-carousel-slide")).toHaveAttribute(
      "data-layout-ready",
      "false",
    );
    expect(screen.getByTestId("memory-carousel-slide")).toHaveAttribute(
      "data-media-ready",
      "false",
    );

    await act(async () => {
      fireEvent.load(screen.getByTestId("memory-carousel-image"));
    });

    expect(screen.getByTestId("memory-carousel-slide")).toHaveAttribute(
      "data-layout-ready",
      "true",
    );

    expect(screen.getByTestId("memory-carousel-image").closest("article")).toHaveAttribute(
      "data-enter-ready",
      "false",
    );

    expect(screen.getByTestId("memory-carousel-image").closest("article")).toHaveAttribute(
      "data-enter-ready",
      "false",
    );

    await waitFor(() => {
      expect(screen.getByTestId("memory-carousel-slide")).toHaveAttribute(
        "data-enter-ready",
        "true",
      );
    });
  });

  it("uses an exit-before-enter transition so a new song waits behind the fade out", () => {
    const { rerender } = renderRail([
      {
        createdAt: 10,
        id: "mem_old",
        note: "Old song memory",
        trackId: "trk_old",
      },
    ]);

    expect(screen.getByTestId("memory-carousel-card")).toHaveAttribute(
      "data-transition",
      "exit-wait-layout-ready",
    );

    rerender(
      <MemoryTimelineRail
        formatCreatedAt={(createdAt) => `time-${createdAt}`}
        labels={labels}
        memories={[
          {
            createdAt: 20,
            id: "mem_new",
            note: "New song first memory",
            photoUrl: "blob:new-song-memory",
            trackId: "trk_new",
          },
        ]}
      />,
    );

    expect(screen.getByTestId("memory-carousel-image").closest("article")).toHaveAttribute(
      "data-enter-ready",
      "false",
    );
  });
});

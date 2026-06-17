import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { assignPagerSlots } from "./cover-pager";
import { CoverPagerStrip, type StripSlot } from "./cover-pager-strip";

const RADIUS = 2;
const WIDTH = 300;

/** Build the windowed strip slots for a centre, using coverless content so the
 *  fallback path renders (the cover path uses CanvasCover, which needs a real
 *  canvas — exercised in the browser, not jsdom). */
function buildSlots(center: number, queueLength: number): StripSlot[] {
  return assignPagerSlots(center, queueLength, RADIUS).map((slot) => ({
    slotKey: slot.slotKey,
    offsetSteps: slot.offsetSteps,
    content: slot.queueIndex == null ? null : { trackId: `trk_${slot.queueIndex}`, coverUrl: null },
  }));
}

function renderStrip(center: number, queueLength: number) {
  return (
    <CoverPagerStrip
      renderFallback={(trackId) => <span data-fallback={trackId}>{trackId}</span>}
      sideScale={0.86}
      slots={buildSlots(center, queueLength)}
      tilt={34}
      width={WIDTH}
    />
  );
}

const slotNode = (root: HTMLElement, offset: number) =>
  root.querySelector<HTMLElement>(`[data-slot-offset="${offset}"]`);

describe("CoverPagerStrip", () => {
  it("renders one persistent slot per window offset", () => {
    const { container } = render(renderStrip(5, 100));
    const offsets = Array.from(container.querySelectorAll("[data-slot-offset]")).map((n) =>
      n.getAttribute("data-slot-offset"),
    );
    expect(offsets).toEqual(["-2", "-1", "0", "1", "2"]);
  });

  it("does NOT remount slot nodes when the centre moves — only the content rotates", () => {
    const { container, rerender } = render(renderStrip(5, 100));
    const before = [-2, -1, 0, 1, 2].map((o) => slotNode(container, o));
    expect(
      slotNode(container, 0)?.querySelector("[data-fallback]")?.getAttribute("data-fallback"),
    ).toBe("trk_5");

    rerender(renderStrip(6, 100));

    const after = [-2, -1, 0, 1, 2].map((o) => slotNode(container, o));
    for (let i = 0; i < 5; i += 1) expect(after[i]).toBe(before[i]);
    // The centre slot now carries the next track (content rotated, node reused).
    expect(
      slotNode(container, 0)?.querySelector("[data-fallback]")?.getAttribute("data-fallback"),
    ).toBe("trk_6");
  });

  it("renders empty (no content) for an out-of-range slot but keeps the node mounted", () => {
    const { container } = render(renderStrip(0, 100)); // offsets -2,-1 are null
    expect(slotNode(container, -2)).not.toBeNull();
    expect(slotNode(container, -2)?.querySelector("[data-fallback]")).toBeNull();
    expect(
      slotNode(container, 0)?.querySelector("[data-fallback]")?.getAttribute("data-fallback"),
    ).toBe("trk_0");
  });
});

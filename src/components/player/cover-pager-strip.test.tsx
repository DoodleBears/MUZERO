import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { assignPagerSlots } from "./cover-pager";
import { CoverPagerStrip, type PagerSlotContent } from "./cover-pager-strip";

const RADIUS = 2;
const WIDTH = 300;
const contentForIndex = (queueIndex: number): PagerSlotContent => ({
  trackId: `trk_${queueIndex}`,
  coverUrl: `cover-${queueIndex}.jpg`,
});

function renderStrip(center: number, queueLength: number) {
  return (
    <CoverPagerStrip
      slots={assignPagerSlots(center, queueLength, RADIUS)}
      width={WIDTH}
      translateX={0}
      contentForIndex={contentForIndex}
    />
  );
}

const slotNode = (root: HTMLElement, slotKey: number) =>
  root.querySelector<HTMLElement>(`[data-slot-key="${slotKey}"]`);

describe("CoverPagerStrip", () => {
  it("renders one persistent slot per pager slotKey", () => {
    const { container } = render(renderStrip(5, 100));
    const keys = Array.from(container.querySelectorAll("[data-slot-key]")).map((n) =>
      n.getAttribute("data-slot-key"),
    );
    expect(keys).toEqual(["0", "1", "2", "3", "4"]);
  });

  it("does NOT remount slot nodes when the center moves — only the cover content rotates", () => {
    const { container, rerender } = render(renderStrip(5, 100));
    // Capture the actual DOM elements for each slotKey before the switch.
    const before = [0, 1, 2, 3, 4].map((k) => slotNode(container, k));
    const centerImgBefore = slotNode(container, 2)?.querySelector("img")?.getAttribute("src");
    expect(centerImgBefore).toBe("cover-5.jpg");

    rerender(renderStrip(6, 100));

    // Same node identity per slotKey → React reused the DOM (no mount/unmount churn).
    const after = [0, 1, 2, 3, 4].map((k) => slotNode(container, k));
    for (let k = 0; k < 5; k++) {
      expect(after[k]).toBe(before[k]);
    }
    // Content rotated by one: the center slot now shows the next track's cover.
    expect(slotNode(container, 2)?.querySelector("img")?.getAttribute("src")).toBe("cover-6.jpg");
  });

  it("renders no <img> for an out-of-range (null) slot, but keeps the slot node mounted", () => {
    const { container } = render(renderStrip(0, 100)); // slots -2,-1 are null
    expect(slotNode(container, 0)).not.toBeNull();
    expect(slotNode(container, 0)?.querySelector("img")).toBeNull();
    expect(slotNode(container, 2)?.querySelector("img")?.getAttribute("src")).toBe("cover-0.jpg");
  });

  it("positions slots at their rest offset and translates the whole strip by translateX", () => {
    const { container } = render(
      <CoverPagerStrip
        slots={assignPagerSlots(5, 100, RADIUS)}
        width={WIDTH}
        translateX={-40}
        contentForIndex={contentForIndex}
      />,
    );
    const strip = container.querySelector<HTMLElement>("[data-testid='cover-pager-strip']");
    expect(strip?.style.transform).toContain("-40px");
    // Slot 0 sits at offset -2 → -600px; center slot 2 at 0px.
    expect(slotNode(container, 0)?.style.transform).toContain("-600px");
    expect(slotNode(container, 2)?.style.transform).toContain("0px");
  });
});

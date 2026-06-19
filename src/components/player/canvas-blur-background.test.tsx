import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasBlurBackground } from "./canvas-blur-background";

vi.mock("@/lib/canvas-blur", () => ({
  drawBlurFrame: vi.fn(),
}));

vi.mock("@/hooks/use-redraw-on-viewport-resize", () => ({
  useRedrawOnViewportResize: vi.fn(),
}));

class MockImage {
  decoding = "";
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  private _src = "";

  get src() {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    window.setTimeout(() => this.onload?.(), 0);
  }
}

class MockResizeObserver {
  observe() {}
  disconnect() {}
}

const OriginalImage = globalThis.Image;
const OriginalResizeObserver = globalThis.ResizeObserver;

describe("CanvasBlurBackground", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: MockImage,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: MockResizeObserver,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(globalThis, "Image", {
      configurable: true,
      value: OriginalImage,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: OriginalResizeObserver,
    });
  });

  it("keeps the fallback image through the fade, then unmounts it", async () => {
    const { container } = render(<CanvasBlurBackground blurPx={24} src="blob:cover" />);

    expect(container.querySelector("img")).toHaveAttribute("src", "blob:cover");

    await act(async () => {
      vi.runOnlyPendingTimers();
    });

    const fadingImage = container.querySelector("img");
    expect(fadingImage).toHaveClass("opacity-0");
    expect(container.querySelectorAll("canvas.opacity-100")).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(320);
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("canvas.opacity-100")).toHaveLength(1);
  });
});

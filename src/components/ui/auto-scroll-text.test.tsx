import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoScrollText } from "./auto-scroll-text";

vi.mock("motion/react", () => ({
  useReducedMotion: () => false,
}));

describe("AutoScrollText", () => {
  let clientWidthDescriptor: PropertyDescriptor | undefined;
  let scrollWidthDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
    Object.defineProperty(global, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
      writable: true,
    });
  });

  afterEach(() => {
    if (clientWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    }
    if (scrollWidthDescriptor) {
      Object.defineProperty(HTMLElement.prototype, "scrollWidth", scrollWidthDescriptor);
    } else {
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    }
  });

  it("animates overflowing text even when the static truncated box reports clipped width", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 120;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).style.width === "max-content" ? 260 : 120;
      },
    });

    const { container } = render(
      <AutoScrollText>Hiroyuki Sawano / Hands Up to the Sky / Very Long Album</AutoScrollText>,
    );

    expect(container.querySelector(".auto-scroll-animate")).toBeInTheDocument();
  });

  it("uses the nearest clipped pill as the visible width when the viewport is wider", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        const element = this as HTMLElement;
        if (element.dataset.testid === "pill") return 140;
        return 260;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return 260;
      },
    });

    const { container } = render(
      <div data-testid="pill" style={{ overflow: "hidden", paddingLeft: 10, paddingRight: 10 }}>
        <AutoScrollText>Hiroyuki Sawano / Hands Up to the Sky / Very Long Album</AutoScrollText>
      </div>,
    );

    expect(container.querySelector(".auto-scroll-animate")).toBeInTheDocument();
  });

  it("can clip static text without rendering a CSS ellipsis", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 260;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return 260;
      },
    });

    const { container } = render(
      <AutoScrollText staticMode="clip">
        Hiroyuki Sawano / Hands Up to the Sky / Very Long Album
      </AutoScrollText>,
    );

    const content = container.querySelector(".whitespace-nowrap");
    expect(content).not.toHaveClass("truncate");
  });

  it("can force CSS-distance scrolling when overflow measurement is unreliable", () => {
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 180;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return 180;
      },
    });

    const { container } = render(
      <AutoScrollText forceScroll staticMode="clip">
        Hiroyuki Sawano / Hands Up to the Sky / Very Long Album
      </AutoScrollText>,
    );

    const content = container.querySelector(".auto-scroll-animate");
    expect(content).toBeInTheDocument();
    expect(content).toHaveStyle({ "--auto-scroll-x": "calc(-100% + 180px)" });
  });
});

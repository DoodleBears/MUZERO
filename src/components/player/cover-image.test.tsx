import { act, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoverImage } from "./cover-image";

const images: MockImage[] = [];
const OriginalImage = globalThis.Image;

vi.mock("motion/react", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MotionImg = React.forwardRef<HTMLImageElement, Record<string, unknown>>((props, ref) => {
    const { animate, exit, initial, transition, ...domProps } = props;
    void animate;
    void exit;
    void initial;
    void transition;
    return React.createElement("img", { ...domProps, ref });
  });
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: { img: MotionImg },
  };
});

beforeEach(() => {
  images.length = 0;
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: MockImage,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: OriginalImage,
  });
});

describe("CoverImage", () => {
  it("keeps the previous image by default while the next image loads", async () => {
    const { container, rerender } = render(
      <CoverImage url="https://img.example/a.jpg" hasCover fallback={<Fallback />} />,
    );

    await loadImage(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.example/a.jpg");

    rerender(<CoverImage url="https://img.example/b.jpg" hasCover fallback={<Fallback />} />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.example/a.jpg");

    await loadImage(1);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://img.example/b.jpg");
  });

  it("clears the previous image while a remote replacement is loading or failed", async () => {
    const { container, rerender } = render(
      <CoverImage
        url="https://img.example/remote-a.jpg"
        hasCover
        holdPreviousWhileLoading={false}
        fallback={<Fallback />}
      />,
    );

    await loadImage(0);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://img.example/remote-a.jpg",
    );

    rerender(
      <CoverImage
        url="https://img.example/remote-b.jpg"
        hasCover
        holdPreviousWhileLoading={false}
        fallback={<Fallback />}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();

    await failImage(1);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByTestId("fallback")).toBeInTheDocument();
  });
});

function Fallback() {
  return <span data-testid="fallback" />;
}

async function loadImage(index: number) {
  await act(async () => {
    images[index]?.onload?.(new Event("load"));
    await Promise.resolve();
  });
}

async function failImage(index: number) {
  await act(async () => {
    images[index]?.onerror?.(new Event("error"));
    await Promise.resolve();
  });
}

class MockImage {
  decoding = "";
  naturalHeight = 50;
  naturalWidth = 100;
  onerror: OnErrorEventHandler = null;
  onload: ((event: Event) => void) | null = null;
  referrerPolicy = "";
  src = "";

  constructor() {
    images.push(this);
  }

  decode(): Promise<void> {
    return Promise.resolve();
  }
}

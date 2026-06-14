import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetLoadedImageCacheForTests, useLoadedImageUrl } from "./use-image-load";

const images: MockImage[] = [];
const OriginalImage = globalThis.Image;
const decodeCalls = vi.fn();

beforeEach(() => {
  images.length = 0;
  decodeCalls.mockClear();
  resetLoadedImageCacheForTests();
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

describe("useLoadedImageUrl", () => {
  it("waits for decode by default before exposing the display url", async () => {
    const { result } = renderHook(() => useLoadedImageUrl("blob:cover-full"));

    expect(result.current.status).toBe("loading");
    expect(result.current.displayUrl).toBeNull();

    await loadImage(0);

    expect(decodeCalls).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("loading");
    expect(result.current.displayUrl).toBeNull();

    await resolveDecode(0);

    expect(result.current.status).toBe("loaded");
    expect(result.current.displayUrl).toBe("blob:cover-full");
  });

  it("can skip active decode and expose the display url on image load", async () => {
    const { result } = renderHook(() => useLoadedImageUrl("blob:cover-full", { decode: false }));

    await loadImage(0);

    expect(decodeCalls).not.toHaveBeenCalled();
    expect(result.current.status).toBe("loaded");
    expect(result.current.displayUrl).toBe("blob:cover-full");
  });

  it("does not reuse a load-only cache hit for a later decode-required request", async () => {
    const loadOnly = renderHook(() => useLoadedImageUrl("blob:cover-full", { decode: false }));
    await loadImage(0);
    expect(loadOnly.result.current.status).toBe("loaded");

    const decodeRequired = renderHook(() => useLoadedImageUrl("blob:cover-full"));

    expect(decodeRequired.result.current.status).toBe("loading");
    expect(decodeRequired.result.current.displayUrl).toBeNull();

    await loadImage(1);
    expect(decodeCalls).toHaveBeenCalledTimes(1);
    await resolveDecode(1);

    expect(decodeRequired.result.current.status).toBe("loaded");
    expect(decodeRequired.result.current.displayUrl).toBe("blob:cover-full");
  });
});

async function loadImage(index: number) {
  await act(async () => {
    images[index]?.onload?.(new Event("load"));
    await Promise.resolve();
  });
}

async function resolveDecode(index: number) {
  await act(async () => {
    images[index]?.resolveDecode();
    await Promise.resolve();
  });
}

class MockImage {
  complete = false;
  decoding = "";
  naturalHeight = 50;
  naturalWidth = 100;
  onerror: OnErrorEventHandler = null;
  onload: ((event: Event) => void) | null = null;
  referrerPolicy = "";
  src = "";
  private decodeResolver: (() => void) | null = null;

  constructor() {
    images.push(this);
  }

  decode(): Promise<void> {
    decodeCalls();
    return new Promise((resolve) => {
      this.decodeResolver = resolve;
    });
  }

  resolveDecode(): void {
    this.decodeResolver?.();
  }
}

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveChatModeForViewport, useChatBreakpoint } from "./use-chat-breakpoint";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveChatModeForViewport", () => {
  it("keeps dock on desktop and promotes it to fullscreen on mobile", () => {
    expect(resolveChatModeForViewport("dock", false)).toBe("dock");
    expect(resolveChatModeForViewport("dock", true)).toBe("fullscreen");
  });

  it("leaves collapsed modes unchanged across breakpoints", () => {
    expect(resolveChatModeForViewport("bar", true)).toBe("bar");
    expect(resolveChatModeForViewport("fab", false)).toBe("fab");
  });
});

describe("useChatBreakpoint", () => {
  it("uses matchMedia to detect mobile chat layout", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    const { result } = renderHook(() => useChatBreakpoint());
    expect(result.current.isMobile).toBe(true);
  });
});

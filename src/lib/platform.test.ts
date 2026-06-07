import { describe, expect, it, vi } from "vitest";
import { openExternalUrl } from "./platform";

describe("openExternalUrl", () => {
  it("opens http links with the browser fallback outside Tauri", async () => {
    const openWindow = vi.fn();

    await openExternalUrl("https://example.com/key", {
      isTauriRuntime: () => false,
      openWindow,
    });

    expect(openWindow).toHaveBeenCalledWith("https://example.com/key", "_blank", "noreferrer");
  });

  it("opens http links with the Tauri opener when available", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const openWindow = vi.fn();

    await openExternalUrl("https://example.com/docs", {
      isTauriRuntime: () => true,
      openUrl,
      openWindow,
    });

    expect(openUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("rejects non-http protocols before opening anything", async () => {
    const openUrl = vi.fn();
    const openWindow = vi.fn();

    await expect(
      openExternalUrl("javascript:alert(1)", {
        isTauriRuntime: () => true,
        openUrl,
        openWindow,
      }),
    ).rejects.toThrow("Unsupported external URL protocol");

    expect(openUrl).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });
});

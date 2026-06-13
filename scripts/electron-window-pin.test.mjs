import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createWindowPinController, normalizeWindowPinMode } = require("../electron/window-pin.cjs");

function createFakeWindow({ ignoreMouseEvents = true } = {}) {
  const listeners = new Map();
  const win = {
    isDestroyed: () => false,
    on: vi.fn((event, callback) => {
      listeners.set(event, callback);
    }),
    setAlwaysOnTop: vi.fn(),
    ...(ignoreMouseEvents
      ? {
          setIgnoreMouseEvents: vi.fn(),
        }
      : {}),
  };
  return { listeners, win };
}

describe("electron window pin controller", () => {
  it("normalizes unknown pin modes to off", () => {
    expect(normalizeWindowPinMode("pin")).toBe("pin");
    expect(normalizeWindowPinMode("pin-click-through")).toBe("pin-click-through");
    expect(normalizeWindowPinMode("surprise")).toBe("off");
    expect(normalizeWindowPinMode(null)).toBe("off");
  });

  it("applies always-on-top and click-through native flags", () => {
    const { win } = createFakeWindow();
    const controller = createWindowPinController();

    expect(controller.applyMode(win, "pin-click-through")).toBe("pin-click-through");

    expect(controller.getMode(win)).toBe("pin-click-through");
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true, { forward: true });
  });

  it("cycles off to pin to click-through to off", () => {
    const { win } = createFakeWindow();
    const controller = createWindowPinController();

    expect(controller.cycleMode(win)).toBe("pin");
    expect(controller.cycleMode(win)).toBe("pin-click-through");
    expect(controller.cycleMode(win)).toBe("off");
    expect(controller.getMode(win)).toBe("off");
    expect(win.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  it("degrades click-through to pin when mouse passthrough is unavailable", () => {
    const { win } = createFakeWindow({ ignoreMouseEvents: false });
    const controller = createWindowPinController();

    expect(controller.applyMode(win, "pin-click-through")).toBe("pin");

    expect(controller.getMode(win)).toBe("pin");
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  it("downgrades click-through to pin when the window regains focus", () => {
    const { listeners, win } = createFakeWindow();
    const onRecovered = vi.fn();
    const controller = createWindowPinController();

    controller.attachFocusRecovery(win, onRecovered);
    controller.applyMode(win, "pin-click-through");
    listeners.get("focus")?.();

    expect(controller.getMode(win)).toBe("pin");
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(onRecovered).toHaveBeenCalledWith("pin");
  });
});

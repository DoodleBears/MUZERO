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
    getBounds: vi.fn(() => ({ height: 400, width: 600, x: 100, y: 100 })),
    webContents: {
      send: vi.fn(),
    },
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

  it("cycles only between off and normal pin", () => {
    const { win } = createFakeWindow();
    const controller = createWindowPinController();

    expect(controller.cycleMode(win)).toBe("pin");
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

  it("keeps click-through locked until an explicit mode change", () => {
    const { listeners, win } = createFakeWindow();
    const onRecovered = vi.fn();
    const controller = createWindowPinController();

    controller.attachFocusRecovery(win, onRecovered);
    controller.applyMode(win, "pin-click-through");
    listeners.get("focus")?.();

    expect(controller.getMode(win)).toBe("pin-click-through");
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("temporarily disables passthrough over registered interactive regions", () => {
    let cursor = { x: 150, y: 130 };
    let poll = () => undefined;
    const { win } = createFakeWindow();
    const controller = createWindowPinController({
      getCursorScreenPoint: () => cursor,
      setIntervalFn: (callback) => {
        poll = callback;
        return 1;
      },
      clearIntervalFn: vi.fn(),
    });

    controller.setInteractiveRegions(win, [{ height: 40, width: 80, x: 40, y: 20 }]);
    controller.applyMode(win, "pin-click-through");

    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(win.webContents.send).toHaveBeenLastCalledWith("muzero:window:clickThroughHover", true);

    cursor = { x: 10, y: 10 };
    poll();

    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(win.webContents.send).toHaveBeenLastCalledWith("muzero:window:clickThroughHover", false);
  });
});

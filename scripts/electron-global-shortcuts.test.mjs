import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createGlobalShortcutRegistry } = require("../electron/global-shortcuts.cjs");

function createFakeElectronRuntime() {
  const callbacks = new Map();
  const sent = [];
  const globalShortcut = {
    register: vi.fn((accelerator, callback) => {
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator) => callbacks.delete(accelerator)),
  };
  const win = {
    isDestroyed: () => false,
    webContents: {
      send: vi.fn((channel, payload) => sent.push({ channel, payload })),
    },
  };
  return { callbacks, globalShortcut, sent, win };
}

describe("electron global shortcut registry", () => {
  it("registers accelerators and emits action events to windows", () => {
    const runtime = createFakeElectronRuntime();
    const registry = createGlobalShortcutRegistry({
      globalShortcut: runtime.globalShortcut,
      getWindows: () => [runtime.win],
    });

    expect(
      registry.configure({
        registrations: [{ actionId: "playback.next", accelerator: "CommandOrControl+Right" }],
      }),
    ).toEqual({
      supported: true,
      statuses: [
        {
          actionId: "playback.next",
          accelerator: "CommandOrControl+Right",
          status: "active",
        },
      ],
    });

    expect(runtime.globalShortcut.register).toHaveBeenCalledWith(
      "CommandOrControl+Right",
      expect.any(Function),
    );
    runtime.callbacks.get("CommandOrControl+Right")?.();
    expect(runtime.sent).toEqual([
      { channel: "muzero:systemShortcuts:action", payload: "playback.next" },
    ]);
  });

  it("unregisters stale accelerators before registering replacements", () => {
    const runtime = createFakeElectronRuntime();
    const registry = createGlobalShortcutRegistry({
      globalShortcut: runtime.globalShortcut,
      getWindows: () => [runtime.win],
    });

    registry.configure({
      registrations: [{ actionId: "playback.next", accelerator: "CommandOrControl+Right" }],
    });
    registry.configure({
      registrations: [{ actionId: "playback.next", accelerator: "CommandOrControl+N" }],
    });

    expect(runtime.globalShortcut.unregister).toHaveBeenCalledWith("CommandOrControl+Right");
    expect(runtime.globalShortcut.register).toHaveBeenCalledWith(
      "CommandOrControl+N",
      expect.any(Function),
    );
  });

  it("surfaces registration failures per action", () => {
    const runtime = createFakeElectronRuntime();
    runtime.globalShortcut.register.mockReturnValueOnce(false);
    const registry = createGlobalShortcutRegistry({
      globalShortcut: runtime.globalShortcut,
      getWindows: () => [runtime.win],
    });

    expect(
      registry.configure({
        registrations: [{ actionId: "playback.like", accelerator: "CommandOrControl+L" }],
      }).statuses,
    ).toEqual([
      {
        actionId: "playback.like",
        accelerator: "CommandOrControl+L",
        status: "failed",
        reason: "registration-failed",
      },
    ]);
  });

  it("unregisters all owned accelerators on teardown", () => {
    const runtime = createFakeElectronRuntime();
    const registry = createGlobalShortcutRegistry({
      globalShortcut: runtime.globalShortcut,
      getWindows: () => [runtime.win],
    });

    registry.configure({
      registrations: [
        { actionId: "playback.prev", accelerator: "CommandOrControl+Left" },
        { actionId: "playback.next", accelerator: "CommandOrControl+Right" },
      ],
    });
    registry.unregisterAll();

    expect(runtime.globalShortcut.unregister).toHaveBeenCalledWith("CommandOrControl+Left");
    expect(runtime.globalShortcut.unregister).toHaveBeenCalledWith("CommandOrControl+Right");
  });
});

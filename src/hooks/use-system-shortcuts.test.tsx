import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SystemShortcutRegistration } from "@/shortcuts/system-global";

const mocks = vi.hoisted(() => ({
  bridge: {} as Record<string, unknown>,
  setTab: vi.fn(),
  actionCtx: { kind: "ctx" },
  runShortcutAction: vi.fn(),
  createShortcutActionRunnerContext: vi.fn((_setTab?: unknown) => ({ kind: "ctx" })),
}));

vi.mock("@/lib/desktop/bridge", () => ({
  resolveDesktopBridge: () => mocks.bridge,
}));

vi.mock("@/stores/nav-store", () => ({
  useNavStore: (sel: (state: { setTab: typeof mocks.setTab }) => unknown) =>
    sel({ setTab: mocks.setTab }),
}));

vi.mock("@/shortcuts/actions", () => ({
  createShortcutActionRunnerContext: (setTab: unknown) =>
    mocks.createShortcutActionRunnerContext(setTab),
  runShortcutAction: (actionId: unknown, ctx: unknown) => mocks.runShortcutAction(actionId, ctx),
}));

import { useSystemShortcuts } from "./use-system-shortcuts";

function createSystemShortcutsBridge() {
  const listeners: Array<(actionId: string) => void> = [];
  return {
    configure: vi.fn(async (registrations: SystemShortcutRegistration[]) => ({
      supported: true,
      statuses: registrations.map((registration) => ({ ...registration, status: "active" })),
    })),
    onAction: vi.fn((callback: (actionId: string) => void) => {
      listeners.push(callback);
      return () => {
        const index = listeners.indexOf(callback);
        if (index >= 0) listeners.splice(index, 1);
      };
    }),
    emit(actionId: string) {
      for (const listener of [...listeners]) listener(actionId);
    },
  };
}

describe("useSystemShortcuts", () => {
  beforeEach(() => {
    mocks.bridge = { kind: "web" };
    mocks.runShortcutAction.mockReset();
    mocks.createShortcutActionRunnerContext.mockClear();
    mocks.setTab.mockReset();
  });

  it("reports unsupported when the desktop bridge has no system shortcut adapter", () => {
    const { result } = renderHook(() => useSystemShortcuts({ enabled: true, registrations: [] }));

    expect(result.current.supported).toBe(false);
    expect(result.current.registering).toBe(false);
  });

  it("syncs registrations and dispatches eligible action events", async () => {
    const systemShortcuts = createSystemShortcutsBridge();
    mocks.bridge = { kind: "electron", systemShortcuts };

    const registrations: SystemShortcutRegistration[] = [
      { actionId: "playback.next", accelerator: "CommandOrControl+Right" },
    ];
    const { result, unmount } = renderHook(() =>
      useSystemShortcuts({ enabled: true, registrations }),
    );

    await waitFor(() => expect(systemShortcuts.configure).toHaveBeenCalledWith(registrations));
    expect(result.current.supported).toBe(true);
    await waitFor(() =>
      expect(result.current.statuses).toEqual([
        { actionId: "playback.next", accelerator: "CommandOrControl+Right", status: "active" },
      ]),
    );

    act(() => systemShortcuts.emit("playback.next"));
    expect(mocks.runShortcutAction).toHaveBeenCalledWith(
      "playback.next",
      expect.objectContaining({ kind: "ctx" }),
    );

    act(() => systemShortcuts.emit("nav.tabNow"));
    expect(mocks.runShortcutAction).toHaveBeenCalledTimes(1);

    unmount();
    await waitFor(() => expect(systemShortcuts.configure).toHaveBeenLastCalledWith([]));
  });

  it("unregisters all accelerators when disabled", async () => {
    const systemShortcuts = createSystemShortcutsBridge();
    mocks.bridge = { kind: "electron", systemShortcuts };

    renderHook(() =>
      useSystemShortcuts({
        enabled: false,
        registrations: [{ actionId: "playback.like", accelerator: "CommandOrControl+L" }],
      }),
    );

    await waitFor(() => expect(systemShortcuts.configure).toHaveBeenCalledWith([]));
  });
});

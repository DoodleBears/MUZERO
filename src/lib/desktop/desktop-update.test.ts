import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type UpdateStatus, useDesktopUpdate } from "./desktop-update";

afterEach(() => {
  // biome-ignore lint/performance/noDelete: test cleanup of the injected global
  delete (window as { muzero?: unknown }).muzero;
});

function installMockUpdater() {
  let emit: ((s: UpdateStatus) => void) | null = null;
  const api = {
    onStatus: vi.fn((cb: (s: UpdateStatus) => void) => {
      emit = cb;
      return () => {
        emit = null;
      };
    }),
    check: vi.fn(async () => ({ kind: "checking" }) as UpdateStatus),
    install: vi.fn(async () => true),
    setChannel: vi.fn(async () => ({ kind: "idle" }) as UpdateStatus),
  };
  (window as { muzero?: unknown }).muzero = { kind: "electron", update: api };
  return { api, emit: (s: UpdateStatus) => emit?.(s) };
}

describe("useDesktopUpdate", () => {
  it("is unsupported and idle on web (no window.muzero)", () => {
    const { result } = renderHook(() => useDesktopUpdate());
    expect(result.current.supported).toBe(false);
    expect(result.current.status).toEqual({ kind: "idle" });
  });

  it("subscribes and reflects broadcast status on the desktop shell", () => {
    const mock = installMockUpdater();
    const { result } = renderHook(() => useDesktopUpdate());
    expect(result.current.supported).toBe(true);
    expect(mock.api.onStatus).toHaveBeenCalled();

    act(() => mock.emit({ kind: "downloading", percent: 42 }));
    expect(result.current.status).toEqual({ kind: "downloading", percent: 42 });

    act(() => mock.emit({ kind: "downloaded", version: "0.8.0" }));
    expect(result.current.status.kind).toBe("downloaded");
  });

  it("forwards check/install/setChannel to the bridge", () => {
    const mock = installMockUpdater();
    const { result } = renderHook(() => useDesktopUpdate());
    act(() => result.current.check());
    act(() => result.current.install());
    act(() => result.current.setChannel("beta"));
    expect(mock.api.check).toHaveBeenCalled();
    expect(mock.api.install).toHaveBeenCalled();
    expect(mock.api.setChannel).toHaveBeenCalledWith("beta");
  });
});

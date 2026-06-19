import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type UpdateStatus, useDesktopUpdate } from "./desktop-update";

afterEach(() => {
  delete (window as { muzero?: unknown }).muzero;
});

function installMockUpdater(opts: { initial?: UpdateStatus; deferStatus?: boolean } = {}) {
  let emit: ((s: UpdateStatus) => void) | null = null;
  let resolveStatus: ((s: UpdateStatus) => void) | null = null;
  const initial = opts.initial ?? ({ kind: "idle" } as UpdateStatus);
  const api = {
    onStatus: vi.fn((cb: (s: UpdateStatus) => void) => {
      emit = cb;
      return () => {
        emit = null;
      };
    }),
    getStatus: vi.fn(
      () =>
        new Promise<UpdateStatus>((resolve) => {
          if (opts.deferStatus) resolveStatus = resolve;
          else resolve(initial);
        }),
    ),
    check: vi.fn(async () => ({ kind: "checking" }) as UpdateStatus),
    install: vi.fn(async () => true),
    setChannel: vi.fn(async () => ({ kind: "idle" }) as UpdateStatus),
  };
  (window as { muzero?: unknown }).muzero = { kind: "electron", update: api };
  return {
    api,
    emit: (s: UpdateStatus) => emit?.(s),
    resolveStatus: (s: UpdateStatus) => resolveStatus?.(s),
  };
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

  // Regression: the startup auto-check broadcasts before the About UI mounts, so
  // those events are dropped. Without seeding from the main process's last-known
  // status, a background download stays invisible until a manual re-check.
  it("seeds from the last-known status when it mounts after an auto-check", async () => {
    const mock = installMockUpdater({ initial: { kind: "downloaded", version: "1.3.0" } });
    const { result } = renderHook(() => useDesktopUpdate());

    await waitFor(() => expect(result.current.status.kind).toBe("downloaded"));
    expect(result.current.status.version).toBe("1.3.0");
    expect(mock.api.getStatus).toHaveBeenCalled();
    // It reflected the auto-check without any broadcast or manual check().
    expect(mock.api.check).not.toHaveBeenCalled();
  });

  it("does not clobber a live broadcast with a slower getStatus seed", async () => {
    const mock = installMockUpdater({ deferStatus: true });
    const { result } = renderHook(() => useDesktopUpdate());

    // A fresh broadcast arrives before the seed resolves.
    act(() => mock.emit({ kind: "checking" }));
    expect(result.current.status.kind).toBe("checking");

    // The seed (older/idle) resolves afterwards and must not overwrite it.
    await act(async () => {
      mock.resolveStatus({ kind: "idle" });
    });
    expect(result.current.status.kind).toBe("checking");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@/lib/desktop/desktop-update";
import { createUpdateReconciler, type UpdateIndicatorView } from "./update-indicator";

function fakeView() {
  let counter = 0;
  return {
    loading: vi.fn((_message: string, _opts?: { progress?: number }) => `notif-${++counter}`),
    update: vi.fn((_id: string, _patch: { progress?: number }) => {}),
    success: vi.fn(
      (_message: string, _opts?: { duration?: number; actions?: unknown[] }) =>
        `notif-${++counter}`,
    ),
    dismiss: vi.fn((_id: string) => {}),
  } satisfies UpdateIndicatorView;
}

// Echo key + version so assertions can read what was localized.
const t = (key: string, opts?: Record<string, unknown>) =>
  opts && "version" in opts ? `${key}:${opts.version}` : key;

function setup() {
  const view = fakeView();
  const install = vi.fn();
  const reconcile = createUpdateReconciler({ view, t, install });
  return { view, install, reconcile };
}

const s = (kind: UpdateStatus["kind"], extra: Partial<UpdateStatus> = {}): UpdateStatus => ({
  kind,
  ...extra,
});

describe("createUpdateReconciler", () => {
  it("stays silent for checking / idle / error / manual-required", () => {
    const { view, reconcile } = setup();
    for (const kind of ["checking", "idle", "error", "manual-required"] as const) {
      reconcile(s(kind));
    }
    expect(view.loading).not.toHaveBeenCalled();
    expect(view.success).not.toHaveBeenCalled();
  });

  it("shows ONE persistent download toast on available, with the version label", () => {
    const { view, reconcile } = setup();
    reconcile(s("available", { version: "1.4.1" }));
    expect(view.loading).toHaveBeenCalledTimes(1);
    expect(view.loading.mock.calls[0][0]).toBe("update.available:1.4.1");
  });

  it("updates progress in place across downloading ticks (no second toast)", () => {
    const { view, reconcile } = setup();
    reconcile(s("available", { version: "1.4.1" }));
    reconcile(s("downloading", { percent: 25 }));
    reconcile(s("downloading", { percent: 80 }));

    expect(view.loading).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledTimes(2);
    expect(view.update.mock.calls[0][1]).toEqual({ progress: 0.25 });
    expect(view.update.mock.calls[1][1]).toEqual({ progress: 0.8 });
  });

  it("swaps the download toast for a persistent, actionable success on downloaded", () => {
    const { view, install, reconcile } = setup();
    reconcile(s("available", { version: "1.4.1" }));
    reconcile(s("downloaded", { version: "1.4.1" }));

    expect(view.dismiss).toHaveBeenCalledWith("notif-1");
    expect(view.success).toHaveBeenCalledTimes(1);
    const [message, opts] = view.success.mock.calls[0];
    expect(message).toBe("update.downloaded:1.4.1");
    expect(opts?.duration).toBe(0); // persistent
    const action = opts?.actions?.[0] as { label: string; onClick: () => void };
    expect(action.label).toBe("update.restartToUpdate");
    action.onClick();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("reuses the version captured from available when downloaded omits it", () => {
    const { view, reconcile } = setup();
    reconcile(s("available", { version: "1.4.1" }));
    reconcile(s("downloading", { percent: 50 }));
    reconcile(s("downloaded")); // electron-updater's downloaded can lack a version
    expect(view.success.mock.calls[0][0]).toBe("update.downloaded:1.4.1");
  });

  it("pushes the ready toast only once across repeated downloaded broadcasts", () => {
    const { view, reconcile } = setup();
    reconcile(s("downloaded", { version: "1.4.1" }));
    reconcile(s("downloaded", { version: "1.4.1" }));
    expect(view.success).toHaveBeenCalledTimes(1);
  });

  it("dismisses a stale download toast if the flow resets to idle mid-download", () => {
    const { view, reconcile } = setup();
    reconcile(s("available", { version: "1.4.1" }));
    reconcile(s("idle"));
    expect(view.dismiss).toHaveBeenCalledWith("notif-1");
  });
});

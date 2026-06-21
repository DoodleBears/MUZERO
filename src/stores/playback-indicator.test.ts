import { describe, expect, it, vi } from "vitest";
import {
  createPlaybackReconciler,
  type PlaybackIndicatorView,
  type PlaybackLoadingLike,
} from "./playback-indicator";

function loading(partial: Partial<PlaybackLoadingLike> = {}): PlaybackLoadingLike {
  return { trackId: "trk_a", title: "Song A", sourceKind: "remote", ...partial };
}

type LoadingOpts = { progress?: number };

function fakeView() {
  let counter = 0;
  return {
    loading: vi.fn((_message: string, _opts?: LoadingOpts) => `notif-${++counter}`),
    update: vi.fn((_id: string, _patch: { message?: string; progress?: number }) => {}),
    dismiss: vi.fn((_id: string) => {}),
  } satisfies PlaybackIndicatorView;
}

/** Manual timer so the threshold is deterministic (no real clock). */
function timerHarness() {
  let cb: (() => void) | null = null;
  let armed = 0;
  let cleared = 0;
  return {
    setTimer: (fn: () => void, _ms: number) => {
      cb = fn;
      armed += 1;
      return armed;
    },
    clearTimer: (_id: number) => {
      cleared += 1;
      cb = null;
    },
    fire: () => {
      const fn = cb;
      cb = null;
      fn?.();
    },
    armedCount: () => armed,
    clearedCount: () => cleared,
  };
}

const t = (key: string, opts?: Record<string, unknown>) => `${key}:${opts?.title}`;

function setup() {
  const view = fakeView();
  const timer = timerHarness();
  const reconcile = createPlaybackReconciler({
    view,
    t,
    thresholdMs: 800,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  return { view, timer, reconcile };
}

describe("createPlaybackReconciler", () => {
  it("does NOT show a toast if loading clears before the threshold fires", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading());
    expect(timer.armedCount()).toBe(1);
    reconcile(null); // finished fast

    expect(timer.clearedCount()).toBe(1);
    expect(view.loading).not.toHaveBeenCalled();
  });

  it("shows a toast once the threshold timer fires", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading({ progress: 0.2 }));
    timer.fire();

    expect(view.loading).toHaveBeenCalledTimes(1);
    const [message, opts] = view.loading.mock.calls[0];
    expect(message).toBe("player.loadingRemote:Song A");
    expect(opts?.progress).toBe(0.2);
  });

  it("uses the local-load label for non-remote sources", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading({ sourceKind: "blob" }));
    timer.fire();

    expect(view.loading.mock.calls[0][0]).toBe("player.loadingTrack:Song A");
  });

  it("arms the threshold timer only once across pre-threshold progress ticks", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading({ progress: 0.1 }));
    reconcile(loading({ progress: 0.3 }));
    reconcile(loading({ progress: 0.6 }));
    expect(timer.armedCount()).toBe(1);

    timer.fire();
    // Shows the LATEST progress captured before the threshold.
    expect(view.loading.mock.calls[0][1]?.progress).toBe(0.6);
  });

  it("updates the shown toast in place as progress advances (no second toast)", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading({ progress: 0 }));
    timer.fire();
    reconcile(loading({ progress: 0.75 }));

    expect(view.loading).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledWith("notif-1", {
      message: "player.loadingRemote:Song A",
      progress: 0.75,
    });
  });

  it("dismisses the toast when loading finishes after it was shown", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading());
    timer.fire();
    reconcile(null);

    expect(view.dismiss).toHaveBeenCalledWith("notif-1");
  });

  it("does nothing on a null tick when nothing is pending or shown", () => {
    const { view, timer, reconcile } = setup();

    reconcile(null);

    expect(view.loading).not.toHaveBeenCalled();
    expect(view.dismiss).not.toHaveBeenCalled();
    expect(timer.clearedCount()).toBe(0);
  });

  it("re-arms for the next track after one finished", () => {
    const { view, timer, reconcile } = setup();

    reconcile(loading({ trackId: "trk_a" }));
    timer.fire();
    reconcile(null);
    reconcile(loading({ trackId: "trk_b", title: "Song B" }));
    timer.fire();

    expect(view.loading).toHaveBeenCalledTimes(2);
    expect(view.loading.mock.calls[1][0]).toBe("player.loadingRemote:Song B");
  });
});

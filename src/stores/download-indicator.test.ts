import { describe, expect, it, vi } from "vitest";
import type { DownloadJob } from "@/db/types";
import type { NotificationAction } from "@/stores/notification-store";
import {
  createDownloadReconciler,
  type DownloadIndicatorView,
  summarizeDownloadJobs,
} from "./download-indicator";

function job(partial: Partial<DownloadJob>): DownloadJob {
  return {
    id: "dlj_1",
    source: "youtube",
    externalId: "x",
    title: "song",
    status: "active",
    bytesDone: 0,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  };
}

describe("summarizeDownloadJobs", () => {
  it("is empty for no jobs", () => {
    expect(summarizeDownloadJobs([])).toEqual({ count: 0, progress: null });
  });

  it("ignores terminal jobs (done/failed)", () => {
    const jobs = [job({ id: "a", status: "done" }), job({ id: "b", status: "failed" })];
    expect(summarizeDownloadJobs(jobs)).toEqual({ count: 0, progress: null });
  });

  it("counts active + pending but reports no progress without totals", () => {
    const jobs = [
      job({ id: "a", status: "active", bytesDone: 100 }),
      job({ id: "b", status: "pending" }),
    ];
    expect(summarizeDownloadJobs(jobs)).toEqual({ count: 2, progress: null });
  });

  it("averages byte progress over active jobs that report totalBytes", () => {
    const jobs = [
      job({ id: "a", status: "active", bytesDone: 50, totalBytes: 100 }), // 0.5
      job({ id: "b", status: "active", bytesDone: 25, totalBytes: 100 }), // 0.25
    ];
    expect(summarizeDownloadJobs(jobs)).toEqual({ count: 2, progress: 0.375 });
  });

  it("averages only the jobs that have totals (blob-transport jobs excluded from progress)", () => {
    const jobs = [
      job({ id: "a", status: "active", bytesDone: 80, totalBytes: 100 }), // 0.8
      job({ id: "b", status: "active", bytesDone: 999 }), // no total (YouTube blob)
    ];
    const { count, progress } = summarizeDownloadJobs(jobs);
    expect(count).toBe(2);
    expect(progress).toBe(0.8);
  });

  it("excludes pending jobs from the progress average even if they carry a total", () => {
    const jobs = [
      job({ id: "a", status: "active", bytesDone: 50, totalBytes: 100 }), // 0.5
      job({ id: "b", status: "pending", bytesDone: 0, totalBytes: 100 }), // not active
    ];
    expect(summarizeDownloadJobs(jobs)).toEqual({ count: 2, progress: 0.5 });
  });
});

type LoadingOpts = { detail?: string; progress?: number; actions?: NotificationAction[] };

function fakeView() {
  let counter = 0;
  const view = {
    loading: vi.fn((_message: string, _opts?: LoadingOpts) => `notif-${++counter}`),
    update: vi.fn(
      (_id: string, _patch: { message?: string; detail?: string; progress?: number }) => {},
    ),
    dismiss: vi.fn((_id: string) => {}),
  };
  return view satisfies DownloadIndicatorView;
}

const t = (key: string, opts?: Record<string, unknown>) =>
  key === "download.inProgress" ? `downloading ${opts?.count}` : key;

describe("createDownloadReconciler", () => {
  it("creates one persistent loading toast on the first in-flight tick", () => {
    const view = fakeView();
    const onView = vi.fn();
    const reconcile = createDownloadReconciler({ view, t, onView });

    reconcile([job({ status: "active", bytesDone: 50, totalBytes: 100 })]);

    expect(view.loading).toHaveBeenCalledTimes(1);
    const [message, opts] = view.loading.mock.calls[0];
    expect(message).toBe("downloading 1");
    expect(opts?.detail).toBe("50%");
    expect(opts?.progress).toBe(0.5);
    expect(opts?.actions).toHaveLength(1);
  });

  it("updates the SAME toast in place on later ticks (no second toast)", () => {
    const view = fakeView();
    const reconcile = createDownloadReconciler({ view, t, onView: vi.fn() });

    reconcile([job({ status: "active", bytesDone: 25, totalBytes: 100 })]);
    reconcile([job({ status: "active", bytesDone: 75, totalBytes: 100 })]);

    expect(view.loading).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledTimes(1);
    expect(view.update).toHaveBeenCalledWith("notif-1", {
      message: "downloading 1",
      detail: "75%",
      progress: 0.75,
    });
  });

  it("dismisses the toast when the queue drains", () => {
    const view = fakeView();
    const reconcile = createDownloadReconciler({ view, t, onView: vi.fn() });

    reconcile([job({ status: "active" })]);
    reconcile([]);

    expect(view.dismiss).toHaveBeenCalledWith("notif-1");
  });

  it("does nothing when the queue is empty and no toast is showing", () => {
    const view = fakeView();
    const reconcile = createDownloadReconciler({ view, t, onView: vi.fn() });

    reconcile([]);

    expect(view.loading).not.toHaveBeenCalled();
    expect(view.dismiss).not.toHaveBeenCalled();
  });

  it("omits the progress bar when no in-flight job reports a total", () => {
    const view = fakeView();
    const reconcile = createDownloadReconciler({ view, t, onView: vi.fn() });

    reconcile([job({ status: "active", bytesDone: 999 })]);

    const [, opts] = view.loading.mock.calls[0];
    expect(opts?.progress).toBeUndefined();
    expect(opts?.detail).toBeUndefined();
  });

  it("wires the view action to onView", () => {
    const view = fakeView();
    const onView = vi.fn();
    const reconcile = createDownloadReconciler({ view, t, onView });

    reconcile([job({ status: "active" })]);
    const [, opts] = view.loading.mock.calls[0];
    opts?.actions?.[0].onClick();

    expect(onView).toHaveBeenCalledTimes(1);
  });

  it("re-creates a toast after the queue drained and refilled", () => {
    const view = fakeView();
    const reconcile = createDownloadReconciler({ view, t, onView: vi.fn() });

    reconcile([job({ status: "active" })]);
    reconcile([]);
    reconcile([job({ status: "active" })]);

    expect(view.loading).toHaveBeenCalledTimes(2);
    expect(view.dismiss).toHaveBeenCalledTimes(1);
  });
});

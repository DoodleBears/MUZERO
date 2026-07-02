import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadJob } from "@/db/types";

// i18n isn't initialized in tests; echo keys (append count) so assertions are deterministic.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
  }),
}));

// The live queue is driven by the test via `jobs`; useLiveQuery just returns it.
let jobs: DownloadJob[] = [];
vi.mock("dexie-react-hooks", () => ({ useLiveQuery: () => jobs }));
vi.mock("@/db/muzero-db", () => ({ db: { downloadJobs: { toArray: () => Promise.resolve([]) } } }));

// Download capability proxy — flip per test for the web vs desktop empty state.
let streaming = true;
vi.mock("@/lib/desktop/bridge", () => ({ hasStreamingSources: () => streaming }));

const clearFinished = vi.fn();
const clearAll = vi.fn();
vi.mock("@/streamsrc/download-action", () => ({
  clearFinishedDownloads: () => clearFinished(),
  clearAllDownloads: () => clearAll(),
  removeDownload: vi.fn(),
  retryDownload: vi.fn(),
}));
vi.mock("@/stores/notification-store", () => ({ notify: { success: vi.fn() } }));

// Sidestep jsdom's lack of layout — the virtualizer's row output is E2E-verified.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 0,
    getVirtualItems: () => [],
    measureElement: () => {},
  }),
}));
// Scroll chrome (Lenis + hover scrollbar) isn't under test here — it's shared with the
// set-detail list and needs real layout/RAF that jsdom lacks.
vi.mock("@/lib/smooth-scroll/use-smooth-scroll", () => ({
  useSmoothScroll: () => ({ lenisRef: { current: null } }),
}));
vi.mock("@/components/library/hover-scrollbar", () => ({ HoverScrollbar: () => null }));

import { DownloadCenter } from "./download-center";

function job(over: Partial<DownloadJob>): DownloadJob {
  return {
    id: "j",
    source: "bili",
    externalId: "BV1",
    title: "t",
    status: "pending",
    bytesDone: 0,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  jobs = [];
  streaming = true;
  localStorage.clear();
});

describe("DownloadCenter", () => {
  it("empty queue on a capable shell shows the download-empty hint", () => {
    render(<DownloadCenter />);
    expect(screen.getByTestId("download-center-empty")).toHaveTextContent("download.queueEmpty");
  });

  it("empty queue on web (no download capability) points to the desktop build", () => {
    streaming = false;
    render(<DownloadCenter />);
    expect(screen.getByTestId("download-center-empty")).toHaveTextContent(
      "downloadCenter.emptyWeb",
    );
  });

  it("filter chips show per-bucket counts (in-flight = active + pending + paused)", () => {
    jobs = [
      job({ id: "a", status: "active" }),
      job({ id: "p", status: "pending" }),
      job({ id: "pa", status: "paused" }),
      job({ id: "d", status: "done" }),
      job({ id: "f1", status: "failed" }),
      job({ id: "f2", status: "failed" }),
    ];
    render(<DownloadCenter />);
    expect(screen.getByTestId("download-filter-all")).toHaveTextContent("6");
    expect(screen.getByTestId("download-filter-active")).toHaveTextContent("3");
    expect(screen.getByTestId("download-filter-done")).toHaveTextContent("1");
    expect(screen.getByTestId("download-filter-failed")).toHaveTextContent("2");
  });

  it("selecting a filter with no matching jobs shows the filtered-empty hint + persists", () => {
    jobs = [job({ id: "d", status: "done" })];
    render(<DownloadCenter />);
    // Default 'all' → the done job is listed (not the empty state).
    expect(screen.queryByTestId("download-center-empty")).toBeNull();
    fireEvent.click(screen.getByTestId("download-filter-failed"));
    expect(screen.getByTestId("download-filter-failed")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("download-center-empty")).toHaveTextContent(
      "downloadCenter.emptyFiltered",
    );
    expect(localStorage.getItem("muzero-download-filter")).toBe("failed");
  });

  it("clear-finished appears only with done jobs and calls the queue action", () => {
    jobs = [job({ id: "a", status: "active" })];
    const { rerender } = render(<DownloadCenter />);
    expect(screen.queryByText("download.queueClear")).toBeNull(); // no done jobs yet
    jobs = [job({ id: "a", status: "active" }), job({ id: "d", status: "done" })];
    rerender(<DownloadCenter />);
    fireEvent.click(screen.getByText("download.queueClear"));
    expect(clearFinished).toHaveBeenCalledTimes(1);
  });

  it("clear-all appears whenever the queue is non-empty and calls clearAllDownloads", () => {
    // Only an active job (nothing finished) → no clear-finished, but clear-all is present.
    jobs = [job({ id: "a", status: "active" })];
    const { rerender } = render(<DownloadCenter />);
    expect(screen.queryByText("download.queueClear")).toBeNull();
    fireEvent.click(screen.getByText("downloadCenter.clearAll"));
    expect(clearAll).toHaveBeenCalledTimes(1);
    // Empty queue → no clear-all button.
    jobs = [];
    rerender(<DownloadCenter />);
    expect(screen.queryByText("downloadCenter.clearAll")).toBeNull();
  });
});

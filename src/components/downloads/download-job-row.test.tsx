import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadJob } from "@/db/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const removeDownload = vi.fn();
const retryDownload = vi.fn();
vi.mock("@/streamsrc/download-action", () => ({
  removeDownload: (id: string) => removeDownload(id),
  retryDownload: (id: string) => retryDownload(id),
}));
vi.mock("@/stores/notification-store", () => ({ notify: { success: vi.fn() } }));

import { DownloadJobRow } from "./download-job-row";

function job(over: Partial<DownloadJob>): DownloadJob {
  return {
    id: "j",
    source: "bili",
    externalId: "BV1",
    title: "Song",
    status: "done",
    bytesDone: 0,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("DownloadJobRow", () => {
  it("a done row with onOpenTrack is a button that jumps to its track", () => {
    const onOpenTrack = vi.fn();
    const j = job({ status: "done", sessionId: "ses_1", trackId: "trk_1" });
    render(<DownloadJobRow job={j} onOpenTrack={onOpenTrack} />);
    fireEvent.click(screen.getByRole("button", { name: /Song/ }));
    expect(onOpenTrack).toHaveBeenCalledWith(j);
  });

  it("a non-done row is not an open-track button", () => {
    const onOpenTrack = vi.fn();
    render(<DownloadJobRow job={job({ status: "active" })} onOpenTrack={onOpenTrack} />);
    expect(screen.queryByRole("button", { name: /Song/ })).toBeNull();
    expect(onOpenTrack).not.toHaveBeenCalled();
  });

  it("a failed row exposes retry + remove wired to the queue actions", () => {
    render(<DownloadJobRow job={job({ id: "f1", status: "failed", lastError: "boom" })} />);
    fireEvent.click(screen.getByRole("button", { name: "download.retry" }));
    fireEvent.click(screen.getByRole("button", { name: "download.remove" }));
    expect(retryDownload).toHaveBeenCalledWith("f1");
    expect(removeDownload).toHaveBeenCalledWith("f1");
  });
});

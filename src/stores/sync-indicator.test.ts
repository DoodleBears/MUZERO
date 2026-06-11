import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setFolderImportProgress } from "./folder-import-store";
import { notify } from "./notification-store";
import { startSyncIndicator } from "./sync-indicator";
import { useSyncStore } from "./sync-store";

const progress = (over: Partial<Parameters<typeof setFolderImportProgress>[0] & object>) =>
  setFolderImportProgress({
    phase: "importing",
    done: 0,
    total: 0,
    imported: 0,
    encrypted: 0,
    decodeFailed: 0,
    ...over,
  });

describe("sync indicator — folder import", () => {
  beforeEach(() => {
    startSyncIndicator(); // idempotent
    setFolderImportProgress(null);
    notify.clear();
  });
  afterEach(() => {
    setFolderImportProgress(null);
    vi.restoreAllMocks();
  });

  it("shows a persistent cancelable toast while importing, then a success toast", () => {
    const loading = vi.spyOn(notify, "loading");
    const update = vi.spyOn(notify, "update");
    const dismiss = vi.spyOn(notify, "dismiss");
    const success = vi.spyOn(notify, "success");

    // Scanning is silent (no toast yet).
    progress({ phase: "scanning" });
    expect(loading).not.toHaveBeenCalled();

    // First real progress → one persistent loading toast carrying a Cancel action.
    progress({ phase: "importing", done: 0, total: 2 });
    expect(loading).toHaveBeenCalledTimes(1);
    expect(loading.mock.calls[0]?.[1]?.actions?.[0]?.keepOpen).toBe(true);

    // Further progress updates the same toast in place.
    progress({ phase: "importing", done: 1, total: 2, imported: 1 });
    expect(update).toHaveBeenCalled();

    // Completion swaps the loading toast for a success toast.
    progress({ phase: "completed", done: 2, total: 2, imported: 2 });
    expect(dismiss).toHaveBeenCalled();
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("keeps the toast alive through the cover-fetch phase after files are imported", () => {
    const loading = vi.spyOn(notify, "loading");
    const update = vi.spyOn(notify, "update");
    const success = vi.spyOn(notify, "success");

    progress({ phase: "importing", done: 7, total: 7, imported: 7 });
    expect(loading).toHaveBeenCalledTimes(1);

    // Covers download after the audio is in — same toast, distinct progress
    // (this is the "stuck at 7/7" the phase fixes).
    progress({ phase: "covers", done: 7, total: 7, imported: 7, coverDone: 0, coverTotal: 5 });
    progress({ phase: "covers", done: 7, total: 7, imported: 7, coverDone: 3, coverTotal: 5 });
    expect(update).toHaveBeenCalled();
    const lastDetail = update.mock.calls.at(-1)?.[1]?.detail;
    expect(lastDetail).toContain("3");
    expect(lastDetail).toContain("5");
    expect(success).not.toHaveBeenCalled(); // not done until covers finish

    progress({ phase: "completed", done: 7, total: 7, imported: 7 });
    expect(success).toHaveBeenCalledTimes(1);
  });

  it("stays silent when a boot scan finds nothing new", () => {
    const loading = vi.spyOn(notify, "loading");
    progress({ phase: "importing", done: 0, total: 0 });
    progress({ phase: "completed", done: 0, total: 0, imported: 0 });
    expect(loading).not.toHaveBeenCalled();
  });
});

describe("sync indicator — R2", () => {
  beforeEach(() => {
    startSyncIndicator(); // idempotent
    useSyncStore.setState({ progressByDrive: {} });
    notify.clear();
  });

  afterEach(() => {
    useSyncStore.setState({ progressByDrive: {} });
    vi.restoreAllMocks();
  });

  it("does not show a success toast for unchanged pull refreshes", () => {
    const loading = vi.spyOn(notify, "loading");
    const dismiss = vi.spyOn(notify, "dismiss");
    const success = vi.spyOn(notify, "success");

    useSyncStore.setState({
      progressByDrive: {
        drv_a: {
          driveId: "drv_a",
          direction: "pull",
          phase: "planning",
          objectsDone: 0,
          objectsTotal: 0,
          bytesDone: 0,
          bytesTotal: 0,
        },
      },
    });
    useSyncStore.setState({
      progressByDrive: {
        drv_a: {
          driveId: "drv_a",
          direction: "pull",
          phase: "completed",
          objectsDone: 0,
          objectsTotal: 3,
          bytesDone: 0,
          bytesTotal: 300,
        },
      },
    });

    expect(loading).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(success).not.toHaveBeenCalled();
  });

  it("keeps the success toast for completed sync runs with a run id", () => {
    const success = vi.spyOn(notify, "success");

    useSyncStore.setState({
      progressByDrive: {
        drv_a: {
          driveId: "drv_a",
          direction: "pull",
          phase: "completed",
          objectsDone: 3,
          objectsTotal: 3,
          bytesDone: 300,
          bytesTotal: 300,
          runId: "run_1",
        },
      },
    });

    expect(success).toHaveBeenCalledTimes(1);
  });
});

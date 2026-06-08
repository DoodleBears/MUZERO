import { describe, expect, it } from "vitest";
import type { SyncRun } from "@/db/types";
import { summarizeSyncRunProgress } from "./sync-progress-summary";

describe("summarizeSyncRunProgress", () => {
  it("reports object counts, byte counts, current phase, and failures for a running push", () => {
    expect(
      summarizeSyncRunProgress(
        syncRun({
          bytesDone: 512,
          objectCount: 4,
          uploaded: 1,
          skipped: 1,
          totalBytes: 1024,
        }),
      ),
    ).toEqual({
      byteRatio: 0.5,
      bytesDone: 512,
      currentPhase: "uploading",
      failed: 0,
      objectCount: 4,
      objectsDone: 2,
      totalBytes: 1024,
    });
  });

  it("reports failed runs with the failed phase and failure count", () => {
    expect(
      summarizeSyncRunProgress(
        syncRun({
          failed: 1,
          status: "failed",
          error: "boom",
        }),
      ),
    ).toMatchObject({
      currentPhase: "failed",
      failed: 1,
      error: "boom",
    });
  });

  it("treats zero-byte completed runs as complete without dividing by zero", () => {
    expect(
      summarizeSyncRunProgress(
        syncRun({
          bytesDone: 0,
          objectCount: 0,
          status: "completed",
          totalBytes: 0,
        }),
      ),
    ).toMatchObject({
      byteRatio: 1,
      currentPhase: "completed",
      objectsDone: 0,
    });
  });
});

function syncRun(overrides: Partial<SyncRun> = {}): SyncRun {
  return {
    id: "run_1",
    driveId: "drv_1",
    direction: "push",
    status: "running",
    startedAt: 1,
    totalBytes: 0,
    bytesDone: 0,
    objectCount: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    ...overrides,
  };
}

import { describe, expect, it } from "vitest";
import {
  copyBlobWithProgress,
  type ImportProgress,
  importProgressPercent,
} from "./import-progress";

describe("copyBlobWithProgress", () => {
  it("copies a blob in chunks and emits byte progress", async () => {
    let clock = 0;
    const events: Array<{ bytesLoaded: number; bytesTotal: number }> = [];
    const source = new Blob([new Uint8Array(10)], { type: "audio/wav" });

    const copied = await copyBlobWithProgress(source, {
      chunkSizeBytes: 4,
      minEmitBytes: 4,
      minEmitIntervalMs: 100,
      now: () => clock,
      onProgress: (progress) => {
        clock += 10;
        events.push(progress);
      },
    });

    expect(copied.type).toBe("audio/wav");
    expect(copied.size).toBe(10);
    expect(new Uint8Array(await copied.arrayBuffer())).toHaveLength(10);
    expect(events).toEqual([
      { bytesLoaded: 0, bytesTotal: 10 },
      { bytesLoaded: 4, bytesTotal: 10 },
      { bytesLoaded: 8, bytesTotal: 10 },
      { bytesLoaded: 10, bytesTotal: 10 },
    ]);
  });

  it("always emits a final 100% event even when throttled", async () => {
    const events: Array<{ bytesLoaded: number; bytesTotal: number }> = [];
    await copyBlobWithProgress(new Blob([new Uint8Array(9)]), {
      chunkSizeBytes: 3,
      minEmitBytes: 100,
      minEmitIntervalMs: 10_000,
      now: () => 0,
      onProgress: (progress) => events.push(progress),
    });

    expect(events).toEqual([
      { bytesLoaded: 0, bytesTotal: 9 },
      { bytesLoaded: 9, bytesTotal: 9 },
    ]);
  });
});

describe("importProgressPercent", () => {
  it("returns a clamped integer percent for copy progress", () => {
    const progress: ImportProgress = {
      phase: "importing",
      total: 1,
      completed: 0,
      current: {
        name: "clip.mp4",
        mode: "copy",
        bytesLoaded: 45,
        bytesTotal: 100,
      },
    };

    expect(importProgressPercent(progress)).toBe(45);
    expect(
      importProgressPercent({
        ...progress,
        current: { name: "clip.mp4", mode: "copy", bytesLoaded: 120, bytesTotal: 100 },
      }),
    ).toBe(100);
  });

  it("returns null for reference mode or unknown totals", () => {
    expect(
      importProgressPercent({
        phase: "importing",
        total: 1,
        completed: 0,
        current: { name: "clip.mp4", mode: "reference" },
      }),
    ).toBeNull();
    expect(
      importProgressPercent({
        phase: "importing",
        total: 1,
        completed: 0,
        current: { name: "clip.mp4", mode: "copy", bytesLoaded: 1, bytesTotal: 0 },
      }),
    ).toBeNull();
  });
});

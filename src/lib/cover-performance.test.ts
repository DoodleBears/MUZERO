import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPerfCounter, resetPerfCounters, setPerfCountersEnabled } from "@/lib/perf-counters";
import { clearTrace, getTraceEntries } from "@/lib/trace";
import { noteCoverRenderCache } from "./cover-performance";

describe("cover performance diagnostics", () => {
  beforeEach(() => {
    clearTrace();
    resetPerfCounters();
  });

  afterEach(() => {
    setPerfCountersEnabled(false);
    resetPerfCounters();
  });

  it("does nothing while perf counters are disabled", () => {
    noteCoverRenderCache("cache-hit", "row", { sourceKind: "local-cover" });

    expect(readPerfCounter("cover.render.row.cache-hit")).toBe(0);
    expect(getTraceEntries()).toHaveLength(0);
  });

  it("records cache hit/miss counters and sanitized trace entries while enabled", () => {
    setPerfCountersEnabled(true);

    noteCoverRenderCache("cache-hit", "row", { sourceKind: "local-cover" });
    noteCoverRenderCache("cache-miss", "now-playing", {
      sourceKind: "remote-cover",
      trackId: "trk_1",
    });

    expect(readPerfCounter("cover.render.row.cache-hit")).toBe(1);
    expect(readPerfCounter("cover.render.now-playing.cache-miss")).toBe(1);
    expect(getTraceEntries()).toEqual([
      expect.objectContaining({
        level: "debug",
        message: "cache-hit",
        scope: "cover.render",
      }),
      expect.objectContaining({
        level: "debug",
        message: "cache-miss",
        scope: "cover.render",
      }),
    ]);
    expect(getTraceEntries()[1]?.data?.[0]).toMatchObject({
      sourceKind: "remote-cover",
      surface: "now-playing",
      trackId: "trk_1",
    });
  });
});

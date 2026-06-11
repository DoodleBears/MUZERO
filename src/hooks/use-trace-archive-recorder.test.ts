import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTraceArchiveRecorder } from "@/hooks/use-trace-archive-recorder";
import { clearTrace, traceEvent } from "@/lib/trace";

const mocks = vi.hoisted(() => ({
  append: vi.fn(async (_entries: unknown[]) => undefined),
  enabled: { value: true },
}));

vi.mock("@/lib/trace-archive", () => ({
  appendTraceArchiveEntries: (entries: unknown[]) => mocks.append(entries),
  isTraceArchiveEnabled: () => mocks.enabled.value,
  subscribeTraceArchiveEnabled: () => () => undefined,
}));

describe("useTraceArchiveRecorder (PRD F-L1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.append.mockClear();
    mocks.enabled.value = true;
    clearTrace();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearTrace();
  });

  it("batches a burst into ONE archive append instead of one per event", () => {
    renderHook(() => useTraceArchiveRecorder());
    for (let i = 0; i < 5; i++) traceEvent("info", "test", `burst ${i}`);
    expect(mocks.append).not.toHaveBeenCalled(); // nothing mid-burst
    vi.advanceTimersByTime(1100);
    expect(mocks.append).toHaveBeenCalledTimes(1);
    const batch = mocks.append.mock.calls[0][0] as Array<{ message: string }>;
    expect(batch).toHaveLength(5);
    expect(batch[0].message).toBe("burst 0");
  });

  it("does not re-archive entries it already flushed", () => {
    renderHook(() => useTraceArchiveRecorder());
    traceEvent("info", "test", "first");
    vi.advanceTimersByTime(1100);
    traceEvent("info", "test", "second");
    vi.advanceTimersByTime(1100);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    const second = mocks.append.mock.calls[1][0] as Array<{ message: string }>;
    expect(second).toHaveLength(1);
    expect(second[0].message).toBe("second");
  });

  it("flushes pending entries on unmount", () => {
    const { unmount } = renderHook(() => useTraceArchiveRecorder());
    traceEvent("info", "test", "pending");
    unmount();
    expect(mocks.append).toHaveBeenCalledTimes(1);
  });

  it("archives nothing while disabled, advancing the watermark instead", () => {
    mocks.enabled.value = false;
    renderHook(() => useTraceArchiveRecorder());
    traceEvent("info", "test", "skipped");
    vi.advanceTimersByTime(2000);
    expect(mocks.append).not.toHaveBeenCalled();
  });
});

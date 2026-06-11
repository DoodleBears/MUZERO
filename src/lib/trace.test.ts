import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearTrace,
  formatTraceEntries,
  getTraceEntries,
  subscribeTrace,
  traceEvent,
} from "@/lib/trace";

describe("trace ring", () => {
  afterEach(() => {
    clearTrace();
  });

  it("records entries in order with monotonic ids", () => {
    traceEvent("info", "test", "first");
    traceEvent("warn", "test", "second");
    const entries = getTraceEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe("first");
    expect(entries[1].message).toBe("second");
    expect(entries[1].id).toBeGreaterThan(entries[0].id);
  });

  it("caps at 300 entries, keeping the most recent in order", () => {
    for (let i = 0; i < 350; i++) traceEvent("debug", "test", `m${i}`);
    const entries = getTraceEntries();
    expect(entries).toHaveLength(300);
    expect(entries[0].message).toBe("m50");
    expect(entries[299].message).toBe("m349");
  });

  it("returns a STABLE snapshot reference between appends (lazy copy — PRD F-L2)", () => {
    traceEvent("info", "test", "a");
    const first = getTraceEntries();
    expect(getTraceEntries()).toBe(first); // no copy per read
    traceEvent("info", "test", "b");
    const second = getTraceEntries();
    expect(second).not.toBe(first); // new identity per append (useSyncExternalStore)
    expect(second).toHaveLength(2);
  });

  it("notifies subscribers per append and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeTrace(listener);
    traceEvent("info", "test", "a");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    traceEvent("info", "test", "b");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("clearTrace empties the ring and the snapshot", () => {
    traceEvent("info", "test", "a");
    clearTrace();
    expect(getTraceEntries()).toHaveLength(0);
    // The ring stays usable after a clear.
    traceEvent("info", "test", "b");
    expect(getTraceEntries()).toHaveLength(1);
  });

  it("formatTraceEntries defaults to the current ring contents", () => {
    traceEvent("error", "scopey", "boom");
    expect(formatTraceEntries()).toContain("ERROR [scopey] boom");
  });
});

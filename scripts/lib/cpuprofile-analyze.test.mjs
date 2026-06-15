import { describe, expect, it } from "vitest";
import { analyzeCpuProfile } from "./cpuprofile-analyze.mjs";

// Mini hand-built profile: root → [appFn (self-heavy), idle].
// node 1 = (root), 2 = appFn (src/foo.ts:10), 3 = (idle)
const profile = {
  nodes: [
    { id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: -1 }, children: [2, 3] },
    { id: 2, callFrame: { functionName: "appFn", url: "http://x/src/foo.ts", lineNumber: 10 }, children: [] },
    { id: 3, callFrame: { functionName: "(idle)", url: "", lineNumber: -1 }, children: [] },
  ],
  samples: [2, 2, 2, 3], // appFn hit 3×, idle 1×
  timeDeltas: [1000, 1000, 1000, 1000], // 1ms each → 4ms total
  startTime: 0,
  endTime: 4000,
};

describe("analyzeCpuProfile", () => {
  it("attributes self time and ranks the hot app function", () => {
    const r = analyzeCpuProfile(profile, { top: 10 });
    expect(r.sampleCount).toBe(4);
    expect(r.durationMs).toBe(4);
    const appFn = r.topSelf.find((e) => e.fn === "appFn");
    expect(appFn).toBeTruthy();
    expect(appFn.selfMs).toBe(3); // 3 samples × 1ms
    expect(appFn.url).toBe("src/foo.ts");
    expect(appFn.line).toBe(10);
  });

  it("buckets idle separately and keeps it out of topSelf", () => {
    const r = analyzeCpuProfile(profile, { top: 10 });
    expect(r.byCategory.idle).toBe(1); // 1ms idle
    expect(r.byCategory.script).toBe(3); // 3ms app
    expect(r.topSelf.some((e) => e.fn === "(idle)")).toBe(false);
  });

  it("computes inclusive total for the root via children", () => {
    const r = analyzeCpuProfile(profile, { top: 10 });
    // root total = appFn(3) + idle(1) = 4ms, but root is filtered from topTotal;
    // appFn total == its self (no children) == 3ms.
    const appTotal = r.topTotal.find((e) => e.fn === "appFn");
    expect(appTotal.totalMs).toBe(3);
  });
});

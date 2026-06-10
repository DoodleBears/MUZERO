import { describe, expect, it } from "vitest";
import {
  type ImmersiveMemoryInput,
  type ImmersiveMemoryState,
  initialImmersiveMemoryState,
  scheduleImmersiveMemory,
} from "./immersive-memory-schedule";
import { MEMORY_DISPLAY_MIN_SHOW_MS, memoryDisplayDurationMs } from "./memory-timeline";

const SHORT = "short";
const LONG = "a really long memory ".repeat(20);

function anchored(id: string, atSec: number, note = SHORT): ImmersiveMemoryInput {
  return { id, note, hasPhoto: false, atSec };
}
function floating(id: string, note = SHORT): ImmersiveMemoryInput {
  return { id, note, hasPhoto: false };
}

/** Drive a sequence of ticks, returning the final state + the activeId per tick. */
function run(
  memories: ImmersiveMemoryInput[],
  ticks: Array<{ nowMs: number; positionSec: number; isPlaying?: boolean; rng?: () => number }>,
  start: ImmersiveMemoryState = initialImmersiveMemoryState,
) {
  let state = start;
  const active: Array<string | null> = [];
  for (const t of ticks) {
    const res = scheduleImmersiveMemory(state, {
      memories,
      nowMs: t.nowMs,
      positionSec: t.positionSec,
      isPlaying: t.isPlaying ?? true,
      rng: t.rng,
    });
    state = res.state;
    active.push(res.activeId);
  }
  return { state, active };
}

describe("scheduleImmersiveMemory", () => {
  it("fires an anchored memory once when playback crosses its second, then retires it", () => {
    const dur = memoryDisplayDurationMs({ note: SHORT });
    const { active } = run(
      [anchored("a", 10)],
      [
        { nowMs: 0, positionSec: 9 },
        { nowMs: 100, positionSec: 10 }, // crosses → show a
        { nowMs: 200, positionSec: 10.4 }, // still within dwell
        { nowMs: 100 + dur + 50, positionSec: 11 }, // dwell over → retire, no re-fire
      ],
    );
    expect(active).toEqual([null, "a", "a", null]);
  });

  it("surfaces exactly one of several same-second anchors and never shows the rest", () => {
    const { active, state } = run(
      [anchored("a", 10), anchored("b", 10), anchored("c", 10)],
      [
        { nowMs: 0, positionSec: 9 },
        { nowMs: 100, positionSec: 10, rng: () => 0.5 }, // 3 crossed → index floor(0.5*3)=1 → "b"
        { nowMs: 1_000_000, positionSec: 30 }, // long later — a/c must never appear
      ],
    );
    expect(active[1]).toBe("b");
    expect(active[2]).toBeNull();
    expect(state.firedAnchorIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("fills idle seconds with floating memories round-robin, sized by content length", () => {
    const durShort = memoryDisplayDurationMs({ note: SHORT });
    const { active } = run(
      [floating("f1"), floating("f2")],
      [
        { nowMs: 0, positionSec: 1 }, // f1
        { nowMs: durShort + 10, positionSec: 2 }, // f1 expired → f2
        { nowMs: 2 * (durShort + 10), positionSec: 3 }, // → back to f1
      ],
    );
    expect(active).toEqual(["f1", "f2", "f1"]);
  });

  it("lets an anchored cue preempt a floating memory only after the minimum show time", () => {
    const memories = [floating("f1", LONG), anchored("a", 10)];
    // Start floating f1 at nowMs 0 (position 5).
    let { state } = run(memories, [{ nowMs: 0, positionSec: 5 }]);
    expect(state.showing?.id).toBe("f1");

    // Anchor crosses at position 10 but f1 has only shown 1s (< MIN_SHOW) → keep f1.
    ({ state } = run(memories, [{ nowMs: 1000, positionSec: 10 }], state));
    expect(state.showing?.id).toBe("f1");
    expect(state.pendingAnchorIds).toEqual(["a"]);

    // Past MIN_SHOW → preempt to the anchored cue.
    const res = scheduleImmersiveMemory(state, {
      memories,
      nowMs: MEMORY_DISPLAY_MIN_SHOW_MS + 100,
      positionSec: 11,
      isPlaying: true,
    });
    expect(res.activeId).toBe("a");
    expect(res.state.showing?.lane).toBe("anchored");
  });

  it("never lets an anchored memory preempt another anchored memory", () => {
    const memories = [anchored("a", 10, LONG), anchored("b", 11)];
    let { state } = run(memories, [
      { nowMs: 0, positionSec: 9 },
      { nowMs: 100, positionSec: 10 }, // show a (anchored, long dwell)
    ]);
    expect(state.showing?.id).toBe("a");

    // b crosses while a is still on screen → a stays, b queued.
    ({ state } = run(memories, [{ nowMs: 200, positionSec: 11 }], state));
    expect(state.showing?.id).toBe("a");
    expect(state.pendingAnchorIds).toContain("b");
  });

  it("drops an anchored cue that would surface too long after its moment", () => {
    // a long floating memory holds the slot; by the time it frees, the anchor is stale.
    const memories = [floating("f1", LONG), anchored("a", 10)];
    let { state } = run(memories, [{ nowMs: 0, positionSec: 5 }]); // f1 shows
    const f1Dur = memoryDisplayDurationMs({ note: LONG });
    // anchor crosses at 10 (queued, f1 still showing)
    ({ state } = run(memories, [{ nowMs: 1000, positionSec: 10 }], state));
    expect(state.pendingAnchorIds).toEqual(["a"]);
    // f1 expires far later, position now 20 → 20-10=10s > stale window → drop a.
    const res = scheduleImmersiveMemory(state, {
      memories,
      nowMs: f1Dur + 100,
      positionSec: 20,
      isPlaying: true,
    });
    expect(res.state.pendingAnchorIds).toEqual([]);
    expect(res.activeId).not.toBe("a");
  });

  it("re-arms anchors after a backward seek / loop", () => {
    const memories = [anchored("a", 10)];
    const durShort = memoryDisplayDurationMs({ note: SHORT });
    let { state } = run(memories, [
      { nowMs: 0, positionSec: 9 },
      { nowMs: 100, positionSec: 10 }, // a fires
      { nowMs: 100 + durShort + 50, positionSec: 11 }, // a retired
    ]);
    expect(state.firedAnchorIds).toContain("a");

    // Seek back to the start → a re-arms.
    ({ state } = run(memories, [{ nowMs: 5000, positionSec: 1 }], state));
    expect(state.firedAnchorIds).not.toContain("a");

    // Crossing again fires it a second time.
    const res = scheduleImmersiveMemory(state, {
      memories,
      nowMs: 5100,
      positionSec: 10,
      isPlaying: true,
    });
    expect(res.activeId).toBe("a");
  });

  it("does not replay every anchor skipped by a large forward jump", () => {
    const memories = [anchored("a", 10), anchored("b", 20), anchored("c", 30)];
    const { active, state } = run(memories, [
      { nowMs: 0, positionSec: 5 },
      { nowMs: 100, positionSec: 35, rng: () => 0 }, // jump past all three
      { nowMs: 1_000_000, positionSec: 36 },
    ]);
    // all three marked fired; at most one was ever surfaced (and it may be dropped as stale).
    expect(state.firedAnchorIds.sort()).toEqual(["a", "b", "c"]);
    expect(active.filter(Boolean).length).toBeLessThanOrEqual(1);
  });

  it("freezes the current memory while paused", () => {
    const memories = [floating("f1"), floating("f2")];
    const { state } = run(memories, [{ nowMs: 0, positionSec: 1 }]);
    expect(state.showing?.id).toBe("f1");
    const cursorBefore = state.floatingCursor;

    const res = scheduleImmersiveMemory(state, {
      memories,
      nowMs: 10_000_000, // would normally expire f1 many times over
      positionSec: 1,
      isPlaying: false,
    });
    expect(res.activeId).toBe("f1");
    expect(res.state.floatingCursor).toBe(cursorBefore);
  });
});

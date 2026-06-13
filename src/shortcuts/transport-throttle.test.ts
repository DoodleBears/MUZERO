import { describe, expect, it, vi } from "vitest";
import { createTransportThrottle } from "./transport-throttle";

function fakeClock() {
  let t = 1000;
  let nextId = 1;
  const timers = new Map<number, { fireAt: number; fn: () => void }>();
  return {
    clock: {
      now: () => t,
      setTimer: (fn: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { fireAt: t + ms, fn });
        return id;
      },
      clearTimer: (id: number) => {
        timers.delete(id);
      },
    },
    advance: (ms: number) => {
      t += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.fireAt <= t) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

describe("createTransportThrottle", () => {
  it("fires the first call immediately (leading edge — a single press has no latency)", () => {
    const { clock } = fakeClock();
    const throttle = createTransportThrottle(200, clock);
    const run = vi.fn();
    throttle(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("collapses a burst within the cooldown to one leading + one trailing (the last intent)", () => {
    const { clock, advance } = fakeClock();
    const throttle = createTransportThrottle(200, clock);
    const runs: string[] = [];
    throttle(() => runs.push("a")); // fires now
    advance(30);
    throttle(() => runs.push("b")); // deferred
    advance(30);
    throttle(() => runs.push("c")); // deferred (replaces b)
    advance(30);
    throttle(() => runs.push("d")); // deferred (replaces c)
    expect(runs).toEqual(["a"]); // only the leading edge so far
    advance(200); // cross the trailing timer
    expect(runs).toEqual(["a", "d"]); // the LAST press lands — release never lost
  });

  it("fires immediately again once the cooldown has elapsed", () => {
    const { clock, advance } = fakeClock();
    const throttle = createTransportThrottle(200, clock);
    const run = vi.fn();
    throttle(run);
    advance(250);
    throttle(run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("caps steady key-repeat to ~the interval rate, not every event", () => {
    const { clock, advance } = fakeClock();
    const throttle = createTransportThrottle(200, clock);
    let fired = 0;
    const run = () => {
      fired += 1;
    };
    // ~1s of 30Hz OS key-repeat (33ms apart).
    for (let i = 0; i < 30; i += 1) {
      throttle(run);
      advance(33);
    }
    // ~1000ms / 200ms ≈ 5 fires — an order less than the 30 raw events.
    expect(fired).toBeGreaterThanOrEqual(4);
    expect(fired).toBeLessThanOrEqual(7);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createAudioFader } from "./audio-fade";

/** A controllable timer queue so ramps advance deterministically. */
function fakeTimers() {
  let seq = 0;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (fn: () => void) => {
      const id = ++seq;
      pending.set(id, fn);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (id: ReturnType<typeof setTimeout>) => {
      pending.delete(id as unknown as number);
    },
    /** Run all currently-scheduled ticks until the queue drains. */
    flush: () => {
      let guard = 0;
      while (pending.size > 0 && guard++ < 1000) {
        const [id, fn] = pending.entries().next().value as [number, () => void];
        pending.delete(id);
        fn();
      }
    },
    size: () => pending.size,
  };
}

describe("createAudioFader", () => {
  it("ramps from → to in even steps and fires onDone at the end", () => {
    const timers = fakeTimers();
    const applied: number[] = [];
    const onDone = vi.fn();
    const fader = createAudioFader({ apply: (v) => applied.push(v), ...timers });

    fader.fadeTo(1, 0, 120); // 120ms / 30ms = 4 steps
    timers.flush();

    expect(applied).toEqual([0.75, 0.5, 0.25, 0]);
    expect(onDone).not.toHaveBeenCalled();
    // last value hits the target
    expect(applied.at(-1)).toBe(0);
  });

  it("calls onDone once the ramp completes", () => {
    const timers = fakeTimers();
    const onDone = vi.fn();
    const fader = createAudioFader({ apply: () => {}, ...timers });
    fader.fadeTo(0, 1, 90, onDone);
    timers.flush();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("applies instantly (no timers) for zero/one-step durations", () => {
    const timers = fakeTimers();
    const applied: number[] = [];
    const onDone = vi.fn();
    const fader = createAudioFader({ apply: (v) => applied.push(v), ...timers });
    fader.fadeTo(0.3, 0.9, 0, onDone);
    expect(applied).toEqual([0.9]);
    expect(onDone).toHaveBeenCalledOnce();
    expect(timers.size()).toBe(0);
  });

  it("cancels an in-flight fade when a new one starts (no overlap)", () => {
    const timers = fakeTimers();
    const applied: number[] = [];
    const fader = createAudioFader({ apply: (v) => applied.push(v), ...timers });
    fader.fadeTo(1, 0, 300); // schedules the first ramp's tick
    fader.fadeTo(0, 1, 60); // cancels it, schedules its own (2 steps)
    timers.flush();
    expect(applied).toEqual([0.5, 1]); // only the second ramp ran
  });

  it("cancel() stops the ramp", () => {
    const timers = fakeTimers();
    const applied: number[] = [];
    const fader = createAudioFader({ apply: (v) => applied.push(v), ...timers });
    fader.fadeTo(1, 0, 300);
    expect(fader.isFading()).toBe(true);
    fader.cancel();
    expect(fader.isFading()).toBe(false);
    timers.flush();
    expect(applied).toEqual([]);
  });
});

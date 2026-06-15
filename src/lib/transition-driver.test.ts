import { describe, expect, it } from "vitest";
import {
  autoCompleteTarget,
  dragDirection,
  manualProgress,
  remainingDurationMs,
  shouldCommitRelease,
} from "./transition-driver";

describe("dragDirection", () => {
  it("maps drag sign to a switch direction (negative x = next)", () => {
    expect(dragDirection(-40)).toBe("next");
    expect(dragDirection(40)).toBe("prev");
    expect(dragDirection(0)).toBeNull();
  });

  it("respects a deadzone", () => {
    expect(dragDirection(-5, 8)).toBeNull();
    expect(dragDirection(-12, 8)).toBe("next");
  });
});

describe("manualProgress", () => {
  it("normalizes |dragX| / width, clamped to 0..1", () => {
    expect(manualProgress(0, 300)).toBe(0);
    expect(manualProgress(-150, 300)).toBeCloseTo(0.5);
    expect(manualProgress(150, 300)).toBeCloseTo(0.5);
    expect(manualProgress(-600, 300)).toBe(1);
  });

  it("is 0 when width is unknown", () => {
    expect(manualProgress(-150, 0)).toBe(0);
  });
});

describe("shouldCommitRelease", () => {
  it("commits when dragged past the distance threshold", () => {
    expect(
      shouldCommitRelease({ progress: 0.4, velocity: 0, direction: "next", threshold: 0.3 }),
    ).toBe(true);
  });

  it("cancels when under threshold and slow", () => {
    expect(
      shouldCommitRelease({ progress: 0.1, velocity: 0, direction: "next", threshold: 0.3 }),
    ).toBe(false);
  });

  it("commits on a fast fling even under the distance threshold (direction-matched)", () => {
    expect(
      shouldCommitRelease({
        progress: 0.1,
        velocity: -900,
        direction: "next",
        flingVelocity: 500,
      }),
    ).toBe(true);
    // A fling in the WRONG direction does not commit.
    expect(
      shouldCommitRelease({
        progress: 0.1,
        velocity: 900,
        direction: "next",
        flingVelocity: 500,
      }),
    ).toBe(false);
  });
});

describe("autoCompleteTarget", () => {
  it("targets 1 to commit, 0 to cancel", () => {
    expect(autoCompleteTarget(true)).toBe(1);
    expect(autoCompleteTarget(false)).toBe(0);
  });
});

describe("remainingDurationMs", () => {
  it("scales the base duration by the remaining distance", () => {
    expect(remainingDurationMs({ fromProgress: 0, toProgress: 1, baseMs: 300 })).toBe(300);
    expect(remainingDurationMs({ fromProgress: 0.5, toProgress: 1, baseMs: 300 })).toBe(150);
    expect(remainingDurationMs({ fromProgress: 0.8, toProgress: 0, baseMs: 300 })).toBe(240);
  });

  it("shortens for a fast release but never below a floor", () => {
    // Fast fling over a small remaining distance → much shorter than proportional.
    const fast = remainingDurationMs({
      fromProgress: 0.8,
      toProgress: 1,
      baseMs: 300,
      velocity: 4000,
      width: 300,
    });
    expect(fast).toBeLessThan(60); // proportional would be 60ms; velocity makes it ~15ms
    expect(fast).toBeGreaterThanOrEqual(Math.round(300 * 0.15)); // floored
  });
});

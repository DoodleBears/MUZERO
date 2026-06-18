import { describe, expect, it } from "vitest";
import { shouldJumpToSourceFromCoverSwipe } from "./swipeable-cover-stage";

describe("shouldJumpToSourceFromCoverSwipe", () => {
  it("treats upward and downward vertical swipes as source jumps", () => {
    expect(
      shouldJumpToSourceFromCoverSwipe({ t: 0, x: 100, y: 100 }, { t: 180, x: 104, y: 36 }),
    ).toBe(true);
    expect(
      shouldJumpToSourceFromCoverSwipe({ t: 0, x: 100, y: 100 }, { t: 180, x: 96, y: 164 }),
    ).toBe(true);
  });

  it("ignores taps and horizontal-dominant gestures", () => {
    expect(
      shouldJumpToSourceFromCoverSwipe({ t: 0, x: 100, y: 100 }, { t: 120, x: 104, y: 106 }),
    ).toBe(false);
    expect(
      shouldJumpToSourceFromCoverSwipe({ t: 0, x: 100, y: 100 }, { t: 180, x: 170, y: 132 }),
    ).toBe(false);
  });

  it("allows fast vertical flicks below the distance threshold", () => {
    expect(
      shouldJumpToSourceFromCoverSwipe({ t: 0, x: 100, y: 100 }, { t: 45, x: 105, y: 72 }),
    ).toBe(true);
  });
});

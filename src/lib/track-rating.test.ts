import { describe, expect, it } from "vitest";
import { resolveTrackRating } from "./track-rating";

describe("resolveTrackRating — crowd average", () => {
  it("returns null with no votes", () => {
    expect(resolveTrackRating({})).toBeNull();
    expect(resolveTrackRating({ ratingsByRater: {} })).toBeNull();
  });

  it("returns a single vote", () => {
    expect(resolveTrackRating({ ratingsByRater: { self: 5 } })).toEqual({ average: 5, count: 1 });
  });

  it("averages votes across raters, one decimal", () => {
    expect(resolveTrackRating({ ratingsByRater: { self: 5, "bili:1": 4, "bili:2": 4 } })).toEqual({
      average: 4.3,
      count: 3,
    });
  });

  it("ignores non-finite values", () => {
    expect(resolveTrackRating({ ratingsByRater: { a: 5, b: Number.NaN } })).toEqual({
      average: 5,
      count: 1,
    });
  });
});

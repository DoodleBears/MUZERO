import { describe, expect, it } from "vitest";
import { formatRatingValue, resolveTrackRating } from "./track-rating";

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

describe("formatRatingValue — at most one decimal", () => {
  it("drops the decimal on whole numbers", () => {
    expect(formatRatingValue(4)).toBe("4");
    expect(formatRatingValue(5.0)).toBe("5");
  });

  it("keeps one decimal on fractional averages", () => {
    expect(formatRatingValue(4.5)).toBe("4.5");
    expect(formatRatingValue(4.3)).toBe("4.3");
  });

  it("rounds finer fractions to one decimal", () => {
    expect(formatRatingValue(4.25)).toBe("4.3");
    expect(formatRatingValue(3.99)).toBe("4");
  });
});

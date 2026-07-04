import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RatingStars } from "./track-rating-chip";

describe("RatingStars", () => {
  it("renders five star buttons and marks the filled ones", () => {
    const { container } = render(<RatingStars value={3} onSelect={() => {}} />);
    expect(container.querySelectorAll("button")).toHaveLength(5);
    expect(container.querySelectorAll("[data-filled='true']")).toHaveLength(3);
  });

  it("calls onSelect with the 1-based clicked star value", () => {
    const onSelect = vi.fn();
    const { container } = render(<RatingStars value={0} onSelect={onSelect} />);
    const buttons = container.querySelectorAll("button");
    buttons[3].click();
    expect(onSelect).toHaveBeenCalledWith(4);
  });
});

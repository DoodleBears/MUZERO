import { fireEvent, render } from "@testing-library/react";
import { Disc3 } from "lucide-react";
import { describe, expect, it } from "vitest";
import { CoverImage } from "./cover-image";

/**
 * CoverImage centralizes the cover render (instant-cover-thumbnails PRD Phase 2):
 * a static surface, a layered <img> that fades in on load, and the no-cover icon.
 * The fade is CSS (survives the Preview hidden-tab rAF freeze) and is disabled
 * under `prefers-reduced-motion`. A cache hit (image already decoded) starts
 * loaded so there's no pointless fade on an instant cover.
 */
describe("CoverImage", () => {
  it("shows the placeholder and no <img> when there is no url", () => {
    const { container, getByTestId } = render(
      <CoverImage url={null} placeholder={<Disc3 data-testid="ph" />} />,
    );
    expect(getByTestId("ph")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the image and fades it in on load", () => {
    const { container } = render(<CoverImage url="blob:cover" alt="cover" />);
    const img = container.querySelector("img");
    if (!img) throw new Error("expected an <img>");
    expect(img).toHaveAttribute("src", "blob:cover");
    // Before load → transparent + loading state.
    expect(img.dataset.state).toBe("loading");
    expect(img.className).toContain("opacity-0");
    // After the browser decodes it → opaque.
    fireEvent.load(img);
    expect(img.dataset.state).toBe("loaded");
    expect(img.className).toContain("opacity-100");
  });

  it("keeps the fade transition disabled for reduced-motion users", () => {
    const { container } = render(<CoverImage url="blob:cover" />);
    expect(container.querySelector("img")?.className).toContain("motion-reduce:transition-none");
  });

  it("resets to loading when the url changes (no stale 'loaded' carryover)", () => {
    const { container, rerender } = render(<CoverImage url="blob:a" />);
    const imgA = container.querySelector("img");
    if (!imgA) throw new Error("expected an <img>");
    fireEvent.load(imgA);
    expect(imgA.dataset.state).toBe("loaded");
    rerender(<CoverImage url="blob:b" />);
    const imgB = container.querySelector("img");
    expect(imgB).toHaveAttribute("src", "blob:b");
    expect(imgB?.dataset.state).toBe("loading"); // new url starts transparent
  });

  it("applies round framing and renders overlay children", () => {
    const round = render(<CoverImage url="blob:a" rounded />);
    expect(round.container.firstElementChild?.className).toContain("rounded-full");
    // Square covers get their corner radius from className; children layer on top.
    const square = render(
      <CoverImage url="blob:a" className="rounded-md">
        <span data-testid="overlay" />
      </CoverImage>,
    );
    expect(square.container.firstElementChild?.className).not.toContain("rounded-full");
    expect(square.container.firstElementChild?.className).toContain("rounded-md");
    expect(square.getByTestId("overlay")).toBeInTheDocument();
  });
});

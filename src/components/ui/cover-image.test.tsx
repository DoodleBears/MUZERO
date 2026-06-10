import { fireEvent, render } from "@testing-library/react";
import { Disc3 } from "lucide-react";
import { rgbaToThumbHash } from "thumbhash";
import { beforeEach, describe, expect, it } from "vitest";
import { thumbhashToBase64 } from "@/lib/cover-thumbhash";
import { CoverImage, resetDecodedCoverUrls } from "./cover-image";

/** A valid base64 thumbhash for a small solid image (so decode succeeds). */
function sampleThumbhash(): string {
  const w = 8;
  const h = 8;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = 200;
    rgba[i + 1] = 80;
    rgba[i + 2] = 40;
    rgba[i + 3] = 255;
  }
  return thumbhashToBase64(rgbaToThumbHash(w, h, rgba));
}

/**
 * CoverImage centralizes the cover render (instant-cover-thumbnails PRD Phase 2):
 * a static surface, a layered <img> that fades in on load, and the no-cover icon.
 * The fade is CSS (survives the Preview hidden-tab rAF freeze) and is disabled
 * under `prefers-reduced-motion`. A cache hit (image already decoded) starts
 * loaded so there's no pointless fade on an instant cover.
 */
describe("CoverImage", () => {
  // The cross-mount "already decoded" memory is module-level and persists across
  // tests; clear it so each test starts cold (a fresh cover that still fades in).
  beforeEach(resetDecodedCoverUrls);

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

  it("shows a decoded thumbhash preview while loading, then drops it once the cover loads", () => {
    const { container } = render(<CoverImage url="blob:cover" thumbhash={sampleThumbhash()} />);
    const preview = container.querySelector("img[data-cover-preview]");
    expect(preview).not.toBeNull();
    expect(preview?.getAttribute("src")).toMatch(/^data:image\/png/);
    // Once the real cover loads, the preview is removed (only the sharp image remains).
    const real = container.querySelector("img[data-state]");
    if (!real) throw new Error("expected the real <img>");
    fireEvent.load(real);
    expect(container.querySelector("img[data-cover-preview]")).toBeNull();
  });

  it("falls back to the plain surface (no preview) when the thumbhash is invalid", () => {
    const { container } = render(<CoverImage url="blob:cover" thumbhash="!!!not-base64!!!" />);
    expect(container.querySelector("img[data-cover-preview]")).toBeNull();
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

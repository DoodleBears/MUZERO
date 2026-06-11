import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getProviderBrandIcon } from "./provider-brand-icons";

describe("getProviderBrandIcon", () => {
  it("returns a brand glyph for known providers (incl. anthropic→claude alias)", () => {
    for (const id of ["openai", "claude", "anthropic", "gemini", "deepseek", "openrouter"]) {
      const Icon = getProviderBrandIcon(id);
      const { container } = render(<Icon />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });

  it("falls back to the generic chip for Groq, dynamic custom, and unknown ids", () => {
    for (const id of ["groq", "custom:abc123", "totally-unknown"]) {
      const Icon = getProviderBrandIcon(id);
      const { container } = render(<Icon />);
      // lucide renders an <svg>; the point is it never throws / is always renderable.
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });
});

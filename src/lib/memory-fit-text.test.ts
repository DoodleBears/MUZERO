import { describe, expect, it, vi } from "vitest";
import { resolveMemoryFitText } from "./memory-fit-text";

function fontSizeFrom(font: string): number {
  return Number.parseInt(font, 10);
}

describe("resolveMemoryFitText", () => {
  it("uses the 64px maximum when the memory fits", () => {
    const measure = vi.fn(() => 60);

    const result = resolveMemoryFitText("tiny note", {
      height: 220,
      measureTextHeight: measure,
      width: 320,
    });

    expect(result.fontSize).toBe(64);
    expect(result.lineHeight).toBe(72);
    expect(measure).toHaveBeenCalledWith("tiny note", 320, expect.stringMatching(/^64px /), 72);
  });

  it("shrinks to the largest measured font size that fits the box", () => {
    const measure = vi.fn((_text: string, _width: number, font: string) => fontSizeFrom(font) * 3);

    const result = resolveMemoryFitText("a longer memory", {
      height: 96,
      measureTextHeight: measure,
      width: 280,
    });

    expect(result.fontSize).toBe(32);
    expect(result.lineHeight).toBe(36);
  });

  it("keeps the minimum when the text still overflows at the floor", () => {
    const measure = vi.fn(() => 999);

    const result = resolveMemoryFitText("too much memory", {
      height: 20,
      measureTextHeight: measure,
      minFontSize: 18,
      width: 120,
    });

    expect(result.fontSize).toBe(18);
  });
});

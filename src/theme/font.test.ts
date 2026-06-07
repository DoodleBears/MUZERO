import { describe, expect, it } from "vitest";
import { customFontStack, DEFAULT_FONT_STACK, primaryFamily } from "./font";

describe("customFontStack", () => {
  it("quotes a spaced name and appends the system fallback", () => {
    expect(customFontStack("Comic Sans MS")).toBe(`"Comic Sans MS", ${DEFAULT_FONT_STACK}`);
  });

  it("does not quote a single-word name", () => {
    expect(customFontStack("Inter")).toBe(`Inter, ${DEFAULT_FONT_STACK}`);
  });

  it("leaves a full stack (already has a comma) untouched", () => {
    expect(customFontStack("Foo, Bar")).toBe("Foo, Bar");
  });

  it("returns the default stack for blank input", () => {
    expect(customFontStack("   ")).toBe(DEFAULT_FONT_STACK);
  });
});

describe("primaryFamily", () => {
  it("returns the first family, unquoted", () => {
    expect(primaryFamily(`"Comic Sans MS", ui-sans-serif, sans-serif`)).toBe("Comic Sans MS");
  });

  it("strips single quotes", () => {
    expect(primaryFamily(`'Inter', sans-serif`)).toBe("Inter");
  });

  it("handles a lone family with no fallback", () => {
    expect(primaryFamily("Georgia")).toBe("Georgia");
  });
});

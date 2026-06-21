import { describe, expect, it } from "vitest";
import { errorToText, extractErrorDebugInfo, formatErrorClipboardText } from "@/lib/error-details";

describe("errorToText", () => {
  it("keeps the stack (which begins with name: message)", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at foo (a.ts:1:1)";
    expect(errorToText(err)).toBe("Error: boom\n    at foo (a.ts:1:1)");
  });

  it("appends HTTP status + code when present (youtubei non-2xx)", () => {
    const err = Object.assign(new Error("The server responded with a non 2xx status code"), {
      stack: "Error: non 2xx",
      status: 403,
      code: "FETCH_FAILED",
    });
    const text = errorToText(err);
    expect(text).toContain("Error: non 2xx");
    expect(text).toContain("status: 403");
    expect(text).toContain("code: FETCH_FAILED");
  });

  it("appends a formatted cause", () => {
    const err = Object.assign(new Error("outer"), {
      stack: "Error: outer",
      cause: new Error("inner reason"),
    });
    expect(errorToText(err)).toContain("cause: Error: inner reason");
  });

  it("falls back to a string for non-Error throws", () => {
    expect(errorToText("plain string")).toBe("plain string");
    expect(errorToText({ a: 1 })).toBe('{"a":1}');
  });
});

describe("extractErrorDebugInfo", () => {
  it("pulls name / message / stack from an Error", () => {
    const info = extractErrorDebugInfo(new Error("boom"));
    expect(info?.name).toBe("Error");
    expect(info?.message).toBe("boom");
    expect(info?.stack).toContain("boom");
  });

  it("formats a nested cause", () => {
    const info = extractErrorDebugInfo(new Error("outer", { cause: new Error("inner") }));
    expect(info?.cause).toBe("Error: inner");
  });

  it("merges catch-site context (componentStack, source)", () => {
    const info = extractErrorDebugInfo(new Error("x"), {
      componentStack: "at <App>",
      source: "boundary",
    });
    expect(info?.componentStack).toBe("at <App>");
    expect(info?.source).toBe("boundary");
  });

  it("reads fields off a plain object (MediaError-like)", () => {
    const info = extractErrorDebugInfo({ message: "decode failed", code: "E_DECODE" });
    expect(info?.message).toBe("decode failed");
    expect(info?.code).toBe("E_DECODE");
  });

  it("stringifies primitives", () => {
    expect(extractErrorDebugInfo("just a string")?.message).toBe("just a string");
  });

  it("returns undefined when there's nothing useful", () => {
    expect(extractErrorDebugInfo(undefined)).toBeUndefined();
  });
});

describe("formatErrorClipboardText", () => {
  it("builds a labeled, multi-line payload", () => {
    const text = formatErrorClipboardText({
      message: "boom",
      detail: "extra",
      createdAt: 0,
      url: "http://example/x",
      userAgent: "UA/1.0",
      context: [{ label: "Viewport", value: "100 x 200" }],
      debug: { name: "Error", stack: "stack-here", componentStack: "comp-here" },
    });
    expect(text).toContain("Error: boom");
    expect(text).toContain("Detail: extra");
    expect(text).toContain("URL: http://example/x");
    expect(text).toContain("UA: UA/1.0");
    expect(text).toContain("Viewport: 100 x 200");
    expect(text).toContain("Stack:\nstack-here");
    expect(text).toContain("Component Stack:\ncomp-here");
  });

  it("drops empty context rows and falls back for an unknown message", () => {
    const text = formatErrorClipboardText({ context: [{ label: "Empty", value: undefined }] });
    expect(text).toBe("Error: Unknown error");
  });
});

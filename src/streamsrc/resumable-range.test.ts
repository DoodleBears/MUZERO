import { describe, expect, it } from "vitest";
import { parseContentRange, planResume, rangeHeader } from "./resumable-range";

describe("rangeHeader", () => {
  it("omits the header at offset 0 (full download), sets bytes=<n>- for a resume", () => {
    expect(rangeHeader(0)).toBeUndefined();
    expect(rangeHeader(500)).toBe("bytes=500-");
  });
});

describe("parseContentRange", () => {
  it("parses 'bytes from-to/total'", () => {
    expect(parseContentRange("bytes 100-999/1000")).toEqual({ from: 100, to: 999, total: 1000 });
  });
  it("treats '*' total as unknown", () => {
    expect(parseContentRange("bytes 0-99/*")).toEqual({ from: 0, to: 99, total: undefined });
  });
  it("returns null for missing / malformed headers", () => {
    expect(parseContentRange(null)).toBeNull();
    expect(parseContentRange("garbage")).toBeNull();
  });
});

describe("planResume", () => {
  it("206 with a matching content-range → append from the requested offset", () => {
    expect(planResume(500, 206, "bytes 500-999/1000")).toEqual({
      mode: "append",
      offset: 500,
      total: 1000,
    });
  });

  it("200 (server ignored Range / fresh URL) → replace from 0", () => {
    expect(planResume(500, 200, null)).toEqual({ mode: "replace", offset: 0, total: undefined });
  });

  it("206 but content-range start ≠ requested offset → replace (mismatch, safest)", () => {
    expect(planResume(500, 206, "bytes 0-999/1000")).toEqual({
      mode: "replace",
      offset: 0,
      total: 1000,
    });
  });

  it("offset 0 is always a fresh full download (append from 0)", () => {
    expect(planResume(0, 200, null)).toEqual({ mode: "append", offset: 0, total: undefined });
    expect(planResume(0, 206, "bytes 0-9/10")).toEqual({ mode: "append", offset: 0, total: 10 });
  });
});

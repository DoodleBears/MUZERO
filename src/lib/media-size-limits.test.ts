import { describe, expect, it } from "vitest";
import {
  exceedsRemoteMediaCacheLimit,
  REMOTE_MEDIA_CACHE_MAX_BYTES,
  RemoteMediaTooLargeError,
  responseContentLength,
} from "@/lib/media-size-limits";

function res(contentLength: string | null) {
  return {
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-length" ? contentLength : null),
    },
  };
}

describe("media size limits (PRD F-8)", () => {
  it("parses a numeric content-length", () => {
    expect(responseContentLength(res("1024"))).toBe(1024);
  });

  it("returns null for a missing or malformed header", () => {
    expect(responseContentLength(res(null))).toBeNull();
    expect(responseContentLength(res("not-a-number"))).toBeNull();
    expect(responseContentLength(res("-5"))).toBeNull();
  });

  it("flags responses past the cap and passes those at/below it", () => {
    expect(exceedsRemoteMediaCacheLimit(res(String(REMOTE_MEDIA_CACHE_MAX_BYTES + 1)))).toBe(true);
    expect(exceedsRemoteMediaCacheLimit(res(String(REMOTE_MEDIA_CACHE_MAX_BYTES)))).toBe(false);
    expect(exceedsRemoteMediaCacheLimit(res("1024"))).toBe(false);
  });

  it("treats an unknown size as NOT exceeding (chunked responses still cache)", () => {
    expect(exceedsRemoteMediaCacheLimit(res(null))).toBe(false);
  });

  it("honors a custom cap", () => {
    expect(exceedsRemoteMediaCacheLimit(res("2048"), 1024)).toBe(true);
  });

  it("RemoteMediaTooLargeError keeps a stable name for cross-layer matching", () => {
    const err = new RemoteMediaTooLargeError(300, 256);
    expect(err.name).toBe("RemoteMediaTooLargeError");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("300");
  });
});

import { describe, expect, it } from "vitest";
import {
  inferMediabunnyContainerKind,
  inferMediabunnyMime,
  isMediabunnySupportedContentType,
} from "@/lib/media-container-format";

describe("mediabunny media container format predicates", () => {
  it("accepts matroska by MIME or extension, including octet-stream uploads", () => {
    expect(isMediabunnySupportedContentType("video/x-matroska", "clip.mkv")).toBe(true);
    expect(isMediabunnySupportedContentType("application/octet-stream", "clip.mkv")).toBe(true);
    expect(isMediabunnySupportedContentType("", "clip.mkv")).toBe(true);
    expect(inferMediabunnyContainerKind("application/octet-stream", "clip.mkv")).toBe("matroska");
    expect(inferMediabunnyMime("clip.mkv")).toBe("video/x-matroska");
  });

  it("accepts common audio/video containers supported by the shared registry", () => {
    expect(isMediabunnySupportedContentType("video/mp4", "movie.mp4")).toBe(true);
    expect(isMediabunnySupportedContentType("video/quicktime", "movie.mov")).toBe(true);
    expect(isMediabunnySupportedContentType("video/webm", "movie.webm")).toBe(true);
    expect(isMediabunnySupportedContentType("audio/flac", "track.flac")).toBe(true);
    expect(isMediabunnySupportedContentType("audio/ogg", "track.opus")).toBe(true);
  });

  it("rejects containers outside the mediabunny import fallback scope", () => {
    expect(isMediabunnySupportedContentType("video/x-msvideo", "clip.avi")).toBe(false);
    expect(inferMediabunnyContainerKind("video/x-msvideo", "clip.avi")).toBeNull();
  });
});

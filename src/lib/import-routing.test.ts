import { describe, expect, it } from "vitest";
import { uploadImportModeForFile } from "./import-routing";

describe("uploadImportModeForFile", () => {
  it("references plaintext media when the shell resolved a real path", () => {
    expect(uploadImportModeForFile({ name: "clip.mp4" } as File, "D:/media/clip.mp4")).toBe(
      "reference",
    );
    expect(uploadImportModeForFile({ name: "song.flac" } as File, "/Users/me/song.flac")).toBe(
      "reference",
    );
  });

  it("copies encrypted ncm files even when a path exists", () => {
    expect(uploadImportModeForFile({ name: "vip.ncm" } as File, "D:/media/vip.ncm")).toBe("copy");
  });

  it("copies memory files when the shell cannot resolve a path", () => {
    expect(uploadImportModeForFile({ name: "clip.mp4" } as File, undefined)).toBe("copy");
    expect(uploadImportModeForFile({ name: "clip.mp4" } as File, "")).toBe("copy");
  });
});

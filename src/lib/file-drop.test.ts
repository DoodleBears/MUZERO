import { describe, expect, it } from "vitest";
import {
  classifyDrop,
  classifyFile,
  dragHasFiles,
  filesFromTransfer,
  summarizeDragItems,
} from "./file-drop";

function file(name: string, type = "", lastModified = 0): File {
  return new File([new Uint8Array(1)], name, { type, lastModified });
}

describe("classifyFile", () => {
  it("classifies by MIME type first", () => {
    expect(classifyFile({ name: "x", type: "video/mp4" })).toBe("video");
    expect(classifyFile({ name: "x", type: "audio/wav" })).toBe("audio");
    expect(classifyFile({ name: "x", type: "image/png" })).toBe("image");
  });

  it("falls back to extension when MIME is missing", () => {
    expect(classifyFile({ name: "clip.MOV", type: "" })).toBe("video");
    expect(classifyFile({ name: "song.flac", type: "" })).toBe("audio");
    expect(classifyFile({ name: "memory.JPEG", type: "" })).toBe("image");
  });

  it("returns null for unsupported files", () => {
    expect(classifyFile({ name: "notes.txt", type: "text/plain" })).toBeNull();
    expect(classifyFile({ name: "archive.zip", type: "" })).toBeNull();
  });
});

describe("classifyDrop", () => {
  it("splits media, images, and skipped", () => {
    const result = classifyDrop([
      file("a.mp4", "video/mp4"),
      file("b.mp3", "audio/mpeg"),
      file("c.png", "image/png"),
      file("d.txt", "text/plain"),
    ]);
    expect(result.media.map((f) => f.name)).toEqual(["a.mp4", "b.mp3"]);
    expect(result.images.map((f) => f.name)).toEqual(["c.png"]);
    expect(result.skipped.map((f) => f.name)).toEqual(["d.txt"]);
  });

  it("handles an empty drop", () => {
    expect(classifyDrop([])).toEqual({ media: [], images: [], skipped: [] });
  });
});

describe("dragHasFiles", () => {
  it("detects the Files marker", () => {
    expect(dragHasFiles(["Files"])).toBe(true);
    expect(dragHasFiles(["text/plain"])).toBe(false);
    expect(dragHasFiles(undefined)).toBe(false);
  });
});

describe("summarizeDragItems", () => {
  const item = (kind: string, type: string) => ({ kind, type }) as DataTransferItem;

  it("counts file items and flags all-images drags", () => {
    expect(summarizeDragItems([item("file", "image/png"), item("file", "image/jpeg")])).toEqual({
      count: 2,
      allImages: true,
    });
    expect(summarizeDragItems([item("file", "image/png"), item("file", "video/mp4")])).toEqual({
      count: 2,
      allImages: false,
    });
  });

  it("ignores non-file items (e.g. dragged text/strings)", () => {
    expect(summarizeDragItems([item("string", "text/plain")])).toEqual({
      count: 0,
      allImages: false,
    });
    expect(summarizeDragItems(undefined)).toEqual({ count: 0, allImages: false });
  });
});

describe("filesFromTransfer", () => {
  const fileItem = (f: File | null): DataTransferItem =>
    ({ kind: "file", getAsFile: () => f }) as unknown as DataTransferItem;
  const stringItem = (): DataTransferItem =>
    ({ kind: "string", getAsFile: () => null }) as unknown as DataTransferItem;
  const transfer = (parts: { files?: File[]; items?: DataTransferItem[] }): DataTransfer =>
    ({
      files: (parts.files ?? []) as unknown as FileList,
      items: parts.items as unknown as DataTransferItemList,
    }) as DataTransfer;

  it("returns [] for a null/undefined transfer", () => {
    expect(filesFromTransfer(null)).toEqual([]);
    expect(filesFromTransfer(undefined)).toEqual([]);
  });

  it("collects every file from a multi-file PASTE where .files holds only the first", () => {
    // The bug: pasting N copied files exposes 1 via .files but all N via .items —
    // the old code short-circuited on .files and dropped the rest.
    const a = file("a.mp3", "audio/mpeg", 1);
    const b = file("b.mp3", "audio/mpeg", 2);
    const c = file("c.mp3", "audio/mpeg", 3);
    const dt = transfer({ files: [a], items: [fileItem(a), fileItem(b), fileItem(c)] });
    expect(filesFromTransfer(dt).map((f) => f.name)).toEqual(["a.mp3", "b.mp3", "c.mp3"]);
  });

  it("dedupes a DROP where .files and .items both carry all files (N, not 2N)", () => {
    const a = file("a.mp3", "audio/mpeg", 1);
    const b = file("b.mp3", "audio/mpeg", 2);
    // A real drop exposes the same files through both channels; the union must
    // collapse them by identity rather than enqueue each track twice.
    const dt = transfer({ files: [a, b], items: [fileItem(a), fileItem(b)] });
    expect(filesFromTransfer(dt)).toHaveLength(2);
  });

  it("falls back to inline item data when .files is empty (pasted screenshot)", () => {
    const img = file("image.png", "image/png", 7);
    const dt = transfer({ files: [], items: [fileItem(img)] });
    expect(filesFromTransfer(dt).map((f) => f.name)).toEqual(["image.png"]);
  });

  it("skips non-file items (dragged text/strings)", () => {
    const a = file("a.wav", "audio/wav", 1);
    const dt = transfer({ files: [], items: [stringItem(), fileItem(a)] });
    expect(filesFromTransfer(dt).map((f) => f.name)).toEqual(["a.wav"]);
  });

  it("keeps a container only .files exposes (.mkv whose items.getAsFile()→null)", () => {
    const mkv = file("clip.mkv", "", 5);
    const dt = transfer({ files: [mkv], items: [fileItem(null)] });
    expect(filesFromTransfer(dt).map((f) => f.name)).toEqual(["clip.mkv"]);
  });
});

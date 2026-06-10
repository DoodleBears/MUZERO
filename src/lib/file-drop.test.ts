import { describe, expect, it } from "vitest";
import {
  classifyDrop,
  classifyFile,
  dragHasFiles,
  filesFromTransfer,
  filesFromTransferDeep,
  summarizeDragItems,
} from "./file-drop";

function file(name: string, type = "", lastModified = 0): File {
  return new File([new Uint8Array(1)], name, { type, lastModified });
}

const fileItem = (f: File | null): DataTransferItem =>
  ({ kind: "file", getAsFile: () => f }) as unknown as DataTransferItem;
const stringItem = (): DataTransferItem =>
  ({ kind: "string", getAsFile: () => null }) as unknown as DataTransferItem;
const transfer = (parts: { files?: File[]; items?: DataTransferItem[] }): DataTransfer =>
  ({
    files: (parts.files ?? []) as unknown as FileList,
    items: parts.items as unknown as DataTransferItemList,
  }) as DataTransfer;

// --- folder-drop (webkitGetAsEntry) fakes -------------------------------------
const fileEntry = (f: File): FileSystemEntry =>
  ({ isFile: true, isDirectory: false, file: (cb: (f: File) => void) => cb(f) }) as never;
const dirEntry = (children: FileSystemEntry[]): FileSystemEntry => {
  let drained = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      // readEntries yields once, then [] (the batch protocol). Flip `drained`
      // BEFORE invoking cb — our reader recurses synchronously inside it.
      readEntries: (cb: (entries: FileSystemEntry[]) => void) => {
        const batch = drained ? [] : children;
        drained = true;
        cb(batch);
      },
    }),
  } as never;
};
const entryItem = (entry: FileSystemEntry | null, asFile: File | null = null): DataTransferItem =>
  ({ kind: "file", webkitGetAsEntry: () => entry, getAsFile: () => asFile }) as never;

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

  it("keeps multi-selected image files when the picker omits MIME types", () => {
    const result = classifyDrop([
      file("one.JPG", "", 1),
      file("two.heic", "", 2),
      file("three.avif", "", 3),
    ]);
    expect(result.images.map((f) => f.name)).toEqual(["one.JPG", "two.heic", "three.avif"]);
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

describe("multi-file paste → classify ingest seam", () => {
  // Mirrors GlobalDropZone's paste path — filesFromTransfer(clipboardData) feeds
  // classifyDrop, which routes media into the active set. Guards the exact seam
  // the bug lived at: a paste exposing only the first file via .files.
  it("routes every pasted media file to the set, not just the first", () => {
    const a = file("a.mp3", "audio/mpeg", 1);
    const b = file("b.wav", "audio/wav", 2);
    const c = file("c.mp4", "video/mp4", 3);
    const dt = transfer({ files: [a], items: [fileItem(a), fileItem(b), fileItem(c)] });
    const { media } = classifyDrop(filesFromTransfer(dt));
    expect(media.map((f) => f.name)).toEqual(["a.mp3", "b.wav", "c.mp4"]);
  });

  it("splits a mixed multi-file paste into media / images / skipped", () => {
    const song = file("song.flac", "audio/flac", 1);
    const clip = file("clip.mov", "video/quicktime", 2);
    const cover = file("cover.png", "image/png", 3);
    const note = file("note.txt", "text/plain", 4);
    // .files holds only the first; .items carries them all.
    const dt = transfer({
      files: [song],
      items: [fileItem(song), fileItem(clip), fileItem(cover), fileItem(note)],
    });
    const { media, images, skipped } = classifyDrop(filesFromTransfer(dt));
    expect(media.map((f) => f.name)).toEqual(["song.flac", "clip.mov"]);
    expect(images.map((f) => f.name)).toEqual(["cover.png"]);
    expect(skipped.map((f) => f.name)).toEqual(["note.txt"]);
  });

  it("extracts every image from an all-images paste (Settings slideshow gallery case)", () => {
    const a = file("a.png", "image/png", 1);
    const b = file("b.jpg", "image/jpeg", 2);
    const c = file("c.webp", "image/webp", 3);
    const dt = transfer({ files: [a], items: [fileItem(a), fileItem(b), fileItem(c)] });
    const { images } = classifyDrop(filesFromTransfer(dt));
    expect(images.map((f) => f.name)).toEqual(["a.png", "b.jpg", "c.webp"]);
  });
});

describe("filesFromTransferDeep", () => {
  it("expands a dropped folder (including nested) into its files", async () => {
    const a = file("a.mp3");
    const b = file("b.flac");
    const c = file("c.mp4");
    const folder = dirEntry([fileEntry(a), dirEntry([fileEntry(c)]), fileEntry(b)]);
    const dt = transfer({ items: [entryItem(folder)] });
    const files = await filesFromTransferDeep(dt);
    expect(files.map((f) => f.name).sort()).toEqual(["a.mp3", "b.flac", "c.mp4"]);
  });

  it("handles a mix of a top-level file and a folder", async () => {
    const top = file("top.mp3");
    const inner = file("inner.wav");
    const dt = transfer({
      items: [entryItem(fileEntry(top)), entryItem(dirEntry([fileEntry(inner)]))],
    });
    const files = await filesFromTransferDeep(dt);
    expect(files.map((f) => f.name).sort()).toEqual(["inner.wav", "top.mp3"]);
  });

  it("falls back to the flat reader when webkitGetAsEntry is unavailable", async () => {
    const a = file("a.mp3", "audio/mpeg", 1);
    const dt = transfer({ files: [a], items: [fileItem(a)] });
    const files = await filesFromTransferDeep(dt);
    expect(files.map((f) => f.name)).toEqual(["a.mp3"]);
  });
});

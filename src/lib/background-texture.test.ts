import { describe, expect, it, vi } from "vitest";
import { loadImageBitmapSource } from "./background-texture";

function fakeBitmap(width = 320, height = 200) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
}

const pngBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

function pngBlobWithSize(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: "image/png" });
}

describe("loadImageBitmapSource", () => {
  it("decodes the fetched blob to an ImageBitmap source (off-thread, no canvas)", async () => {
    const bitmap = fakeBitmap(640, 480);
    const createImageBitmap = vi.fn(async () => bitmap);
    const fetchBlob = vi.fn(async () => pngBlob());

    const source = await loadImageBitmapSource("blob:cover", { createImageBitmap, fetchBlob });

    expect(fetchBlob).toHaveBeenCalledWith("blob:cover", undefined);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(source).toMatchObject({
      bitmap,
      bytes: 3,
      mime: "image/png",
      width: 640,
      height: 480,
    });
    // unload releases the decoded bitmap's memory.
    source?.unload();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("downscales oversized background textures before decoding", async () => {
    const bitmap = fakeBitmap(800, 400);
    const createImageBitmap = vi.fn(async () => bitmap);

    const source = await loadImageBitmapSource("blob:large-cover", {
      createImageBitmap,
      fetchBlob: async () => pngBlobWithSize(1600, 800),
      maxDimension: 800,
    });

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(Blob), {
      resizeHeight: 400,
      resizeQuality: "high",
      resizeWidth: 800,
    });
    expect(source).toMatchObject({
      height: 400,
      resizeMaxDimension: 800,
      sourceHeight: 800,
      sourceWidth: 1600,
      width: 800,
    });
  });

  it("emits fetch/header/decode timing stages for ImageBitmap load attribution", async () => {
    let elapsed = 0;
    const bitmap = fakeBitmap(800, 400);
    const onStage = vi.fn();
    const createImageBitmap = vi.fn(async () => {
      elapsed += 12;
      return bitmap;
    });

    await loadImageBitmapSource("blob:large-cover", {
      createImageBitmap,
      fetchBlob: async () => {
        elapsed += 5;
        return pngBlobWithSize(1600, 800);
      },
      maxDimension: 800,
      now: () => elapsed,
      onStage,
    });

    expect(onStage).toHaveBeenCalledWith(
      "fetch",
      expect.objectContaining({
        bytes: 24,
        durationMs: 5,
        mime: "image/png",
        phase: "success",
      }),
    );
    expect(onStage).toHaveBeenCalledWith(
      "header",
      expect.objectContaining({
        headerSource: "blob-slice",
        resizeHeight: 400,
        resizeMaxDimension: 800,
        resizeWidth: 800,
        sourceHeight: 800,
        sourceWidth: 1600,
      }),
    );
    expect(onStage).toHaveBeenCalledWith(
      "decode",
      expect.objectContaining({
        durationMs: 12,
        height: 400,
        phase: "success",
        resizeMaxDimension: 800,
        width: 800,
      }),
    );
  });

  it("uses provided header bytes instead of slicing the blob again", async () => {
    const bitmap = fakeBitmap(800, 400);
    const createImageBitmap = vi.fn(async () => bitmap);
    const blob = pngBlobWithSize(1600, 800);
    const slice = vi.spyOn(blob, "slice");
    const onStage = vi.fn();
    const headerBytes = new Uint8Array(await blob.arrayBuffer()).subarray(0, 24);

    const source = await loadImageBitmapSource("blob:large-cover", {
      createImageBitmap,
      fetchBlob: async () => ({ blob, headerBytes, headerSource: "fetched-bytes" }),
      maxDimension: 800,
      onStage,
    });

    expect(slice).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledWith(blob, {
      resizeHeight: 400,
      resizeQuality: "high",
      resizeWidth: 800,
    });
    expect(source).toMatchObject({
      resizeMaxDimension: 800,
      sourceHeight: 800,
      sourceWidth: 1600,
    });
    expect(onStage).toHaveBeenCalledWith(
      "header",
      expect.objectContaining({
        headerBytes: 24,
        headerSource: "fetched-bytes",
        sourceHeight: 800,
        sourceWidth: 1600,
      }),
    );
  });

  it("returns null when createImageBitmap is unavailable (caller falls back to <img>)", async () => {
    const fetchBlob = vi.fn(async () => pngBlob());
    const source = await loadImageBitmapSource("blob:cover", {
      createImageBitmap: undefined,
      fetchBlob,
    });
    expect(source).toBeNull();
    // No point fetching bytes we can't decode.
    expect(fetchBlob).not.toHaveBeenCalled();
  });

  it("returns null when decoding throws (corrupt/undecodable source)", async () => {
    const createImageBitmap = vi.fn(async () => {
      throw new Error("The source image could not be decoded.");
    });
    const source = await loadImageBitmapSource("blob:bad", {
      createImageBitmap,
      fetchBlob: async () => pngBlob(),
    });
    expect(source).toBeNull();
  });

  it("returns null for an empty/missing blob (no decode attempted)", async () => {
    const createImageBitmap = vi.fn(async () => fakeBitmap());
    const source = await loadImageBitmapSource("blob:empty", {
      createImageBitmap,
      fetchBlob: async () => new Blob([], { type: "image/png" }),
    });
    expect(source).toBeNull();
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("returns null when fetching the blob fails", async () => {
    const createImageBitmap = vi.fn(async () => fakeBitmap());
    const source = await loadImageBitmapSource("blob:err", {
      createImageBitmap,
      fetchBlob: async () => {
        throw new Error("network");
      },
    });
    expect(source).toBeNull();
  });

  it("rethrows aborts so callers do not fall back to another loader for stale sources", async () => {
    const createImageBitmap = vi.fn(async () => fakeBitmap());
    const fetchBlob = vi.fn(async () => pngBlob());
    const abort = new AbortController();
    abort.abort();

    await expect(
      loadImageBitmapSource("blob:stale", {
        createImageBitmap,
        fetchBlob,
        signal: abort.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchBlob).not.toHaveBeenCalled();
  });
});

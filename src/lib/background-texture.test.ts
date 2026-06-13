import { describe, expect, it, vi } from "vitest";
import { loadImageBitmapSource } from "./background-texture";

function fakeBitmap(width = 320, height = 200) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };
}

const pngBlob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });

describe("loadImageBitmapSource", () => {
  it("decodes the fetched blob to an ImageBitmap source (off-thread, no canvas)", async () => {
    const bitmap = fakeBitmap(640, 480);
    const createImageBitmap = vi.fn(async () => bitmap);
    const fetchBlob = vi.fn(async () => pngBlob());

    const source = await loadImageBitmapSource("blob:cover", { createImageBitmap, fetchBlob });

    expect(fetchBlob).toHaveBeenCalledWith("blob:cover");
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(source).toMatchObject({ bitmap, width: 640, height: 480 });
    // unload releases the decoded bitmap's memory.
    source?.unload();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
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
});

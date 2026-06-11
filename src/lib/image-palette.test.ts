import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractImagePaletteFromFetchedUrl,
  extractImagePaletteFromUrl,
  selectDominantImageColor,
  selectImagePalette,
} from "./image-palette";

function pixels(colors: Array<[number, number, number, number?]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]));
}

/** Repeat a pixel `n` times so a cluster can dominate the bucket scoring. */
function repeat(color: [number, number, number, number?], n: number) {
  return Array.from({ length: n }, () => color);
}

describe("selectDominantImageColor", () => {
  it("prefers saturated cover colors over neutral background pixels", () => {
    const color = selectDominantImageColor(
      pixels([
        [250, 250, 250],
        [248, 248, 248],
        [20, 120, 220],
        [22, 118, 218],
        [24, 121, 221],
      ]),
    );

    expect(color).not.toBeNull();
    expect(color?.b).toBeGreaterThan(color?.r ?? 0);
    expect(color?.b).toBeGreaterThan(color?.g ?? 0);
  });

  it("returns null for transparent or neutral-only art", () => {
    expect(
      selectDominantImageColor(
        pixels([
          [0, 0, 0, 0],
          [230, 230, 230],
          [42, 42, 42],
        ]),
      ),
    ).toBeNull();
  });

  it("equals the first entry of the multi-color palette", () => {
    const px = pixels([...repeat([20, 120, 220], 4), ...repeat([230, 140, 30], 2)]);
    const dominant = selectDominantImageColor(px);
    const palette = selectImagePalette(px, 4);
    expect(palette[0]).toEqual(dominant);
  });
});

describe("selectImagePalette", () => {
  it("returns several distinct chromatic swatches, most dominant first", () => {
    const palette = selectImagePalette(
      pixels([
        ...repeat([248, 248, 248], 4), // neutral bg — filtered out
        ...repeat([20, 120, 220], 6), // blue (dominant)
        ...repeat([230, 140, 30], 4), // orange
        ...repeat([40, 180, 70], 3), // green
      ]),
      4,
    );

    expect(palette).toHaveLength(3);
    // Dominant first: blue (blue channel is the max).
    expect(palette[0].b).toBeGreaterThan(palette[0].r);
    expect(palette[0].b).toBeGreaterThan(palette[0].g);
    // The palette spans the three chromatic clusters.
    expect(palette.some((c) => c.r > c.b && c.r > c.g)).toBe(true); // orange-ish
    expect(palette.some((c) => c.g > c.r && c.g > c.b)).toBe(true); // green-ish
  });

  it("merges near-identical shades into a single swatch", () => {
    const palette = selectImagePalette(
      pixels([
        // five close shades of the same purple
        [120, 40, 200],
        [126, 46, 206],
        [132, 52, 212],
        [138, 58, 218],
        [118, 38, 198],
        // one clearly distinct teal cluster
        ...repeat([20, 180, 180], 4),
      ]),
      4,
    );

    // Despite five purple samples, dedup collapses them to one swatch (+ teal).
    expect(palette).toHaveLength(2);
  });

  it("respects the requested color count", () => {
    const palette = selectImagePalette(
      pixels([
        ...repeat([20, 120, 220], 6), // blue
        ...repeat([220, 40, 40], 5), // red
        ...repeat([40, 180, 70], 4), // green
        ...repeat([230, 200, 30], 3), // yellow
        ...repeat([200, 40, 200], 2), // magenta
      ]),
      3,
    );

    expect(palette).toHaveLength(3);
  });

  it("returns an empty array for transparent or neutral-only art", () => {
    expect(
      selectImagePalette(
        pixels([
          [0, 0, 0, 0],
          [230, 230, 230],
          [42, 42, 42],
        ]),
      ),
    ).toEqual([]);
  });
});

// Streamed covers (NetEase / Bilibili imports) live behind a proxied muzfetch URL,
// not a local Blob. They MUST be loaded CORS-clean or `drawImage` taints the canvas
// and `getImageData` throws → empty palette → flow/spectrum lose the cover color even
// though the cover image is visible. Regression guard for that exact gotcha.
describe("extractImagePaletteFromUrl — canvas CORS for remote covers", () => {
  const realImage = globalThis.Image;
  const realCreateElement = document.createElement.bind(document);
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  let loaded: Array<{ src: string; crossOrigin: string | null }>;

  beforeEach(() => {
    loaded = [];
    class StubImage {
      decoding = "";
      crossOrigin: string | null = null;
      naturalWidth = 2;
      naturalHeight = 2;
      width = 2;
      height = 2;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      get src() {
        return this.#src;
      }
      set src(value: string) {
        this.#src = value;
        loaded.push({ src: value, crossOrigin: this.crossOrigin });
        queueMicrotask(() => this.onload?.());
      }
    }
    // @ts-expect-error minimal stub for the canvas-extraction path
    globalThis.Image = StubImage;
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      if (tag !== "canvas") return realCreateElement(tag);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          drawImage: () => {},
          // one saturated blue pixel so a non-empty palette comes back
          getImageData: () => ({ data: new Uint8ClampedArray([20, 120, 220, 255]) }),
        }),
      } as unknown as HTMLCanvasElement;
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:remote-cover"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    globalThis.Image = realImage;
    restoreUrlMethod("createObjectURL", realCreateObjectURL);
    restoreUrlMethod("revokeObjectURL", realRevokeObjectURL);
    vi.restoreAllMocks();
  });

  it("loads a proxied muzfetch cover with crossOrigin=anonymous (untainted canvas)", async () => {
    const palette = await extractImagePaletteFromUrl("muzfetch://media/?__mzurl=cover");
    expect(loaded.at(-1)?.crossOrigin).toBe("anonymous");
    expect(palette.length).toBeGreaterThan(0); // canvas readable → real color extracted
  });

  it("loads a raw https cover with crossOrigin=anonymous", async () => {
    await extractImagePaletteFromUrl("https://p1.music.126.net/cover.jpg");
    expect(loaded.at(-1)?.crossOrigin).toBe("anonymous");
  });

  it("fetches remote cover bytes first so R2 palette extraction uses a Blob URL", async () => {
    const fetchedBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const fetcher = vi.fn(async () => {
      return {
        ok: true,
        headers: new Headers({ "content-type": "image/png" }),
        blob: async () => fetchedBlob,
      } as Response;
    });

    const palette = await extractImagePaletteFromFetchedUrl("https://r2.example/cover.png", {
      fetcher,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://r2.example/cover.png",
      expect.objectContaining({ cache: "force-cache" }),
    );
    expect(URL.createObjectURL).toHaveBeenCalledWith(fetchedBlob);
    expect(loaded.at(-1)).toMatchObject({ src: "blob:remote-cover", crossOrigin: null });
    expect(palette.length).toBeGreaterThan(0);
  });

  it("infers an image mime from the R2 object URL when the response is octet-stream", async () => {
    const fetchedBlob = new Blob([new Uint8Array([1, 2, 3])], {
      type: "application/octet-stream",
    });
    const fetcher = vi.fn(async () => {
      return {
        ok: true,
        headers: new Headers({ "content-type": "application/octet-stream" }),
        blob: async () => fetchedBlob,
      } as Response;
    });

    const palette = await extractImagePaletteFromFetchedUrl(
      "https://r2.example/objects/covers/sha256-blue.jpg?download=1",
      { fetcher },
    );

    const sampledBlob = vi.mocked(URL.createObjectURL).mock.calls[0]?.[0] as Blob | undefined;
    expect(sampledBlob?.type).toBe("image/jpeg");
    expect(palette.length).toBeGreaterThan(0);
  });
});

function restoreUrlMethod(name: "createObjectURL" | "revokeObjectURL", value: unknown) {
  if (typeof value === "function") {
    Object.defineProperty(URL, name, { configurable: true, value });
  } else {
    delete (URL as unknown as Record<string, unknown>)[name];
  }
}

import { rgbaToThumbHash } from "thumbhash";
import { describe, expect, it } from "vitest";
import { base64ToThumbhash, encodeCoverThumbhash, thumbhashToBase64 } from "./cover-thumbhash";

describe("cover-thumbhash base64", () => {
  it("round-trips thumbhash bytes through base64", () => {
    const w = 8;
    const h = 8;
    const rgba = new Uint8Array(w * h * 4).fill(120);
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255; // opaque
    const bytes = rgbaToThumbHash(w, h, rgba);
    const b64 = thumbhashToBase64(bytes);
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
    expect(Array.from(base64ToThumbhash(b64))).toEqual(Array.from(bytes));
  });

  it("decodes base64 that was produced elsewhere", () => {
    // A known small byte sequence survives the round-trip exactly.
    const bytes = new Uint8Array([1, 2, 3, 250, 200, 0, 15]);
    expect(Array.from(base64ToThumbhash(thumbhashToBase64(bytes)))).toEqual(Array.from(bytes));
  });
});

describe("encodeCoverThumbhash", () => {
  it("returns undefined (not throw) when image decoding is unavailable (e.g. jsdom / non-browser)", async () => {
    // jsdom has no createImageBitmap / canvas 2d pixels — the helper must degrade
    // gracefully so a cover-set never fails just because a preview couldn't be made.
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    await expect(encodeCoverThumbhash(blob)).resolves.toBeUndefined();
  });
});

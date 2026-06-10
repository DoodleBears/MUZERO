import { describe, expect, it } from "vitest";
import { rgbaToThumbHash, thumbHashToApproximateAspectRatio, thumbHashToRGBA } from "./thumbhash";

/** Build a w×h RGBA buffer from a per-pixel color fn. */
function makeRgba(
  w: number,
  h: number,
  fn: (x: number, y: number) => [number, number, number, number],
) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const [r, g, b, a] = fn(x, y);
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

/** Average RGB over the opaque pixels of a buffer. */
function avgRgb(rgba: Uint8Array): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  const n = rgba.length / 4;
  for (let i = 0; i < rgba.length; i += 4) {
    r += rgba[i];
    g += rgba[i + 1];
    b += rgba[i + 2];
  }
  return [r / n, g / n, b / n];
}

/**
 * The codec is vendored from Evan Wallace's MIT reference. We only ever encode
 * AND decode with this same module (no external interop), so the contract that
 * matters is internal: a round-trip preserves the dominant color and orientation.
 */
describe("thumbhash codec (vendored)", () => {
  it("round-trips a solid color so the decoded preview keeps that color", () => {
    const w = 24;
    const h = 24;
    const orange: [number, number, number, number] = [220, 120, 40, 255];
    const hash = rgbaToThumbHash(
      w,
      h,
      makeRgba(w, h, () => orange),
    );
    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBeGreaterThanOrEqual(5);

    const out = thumbHashToRGBA(hash);
    expect(out.w).toBeGreaterThan(0);
    expect(out.h).toBeGreaterThan(0);
    const [r, g, b] = avgRgb(out.rgba);
    // Lossy, but a solid fill should land near the source color.
    expect(Math.abs(r - 220)).toBeLessThan(40);
    expect(Math.abs(g - 120)).toBeLessThan(40);
    expect(Math.abs(b - 40)).toBeLessThan(40);
  });

  it("encodes aspect ratio into the hash (landscape > 1, portrait < 1)", () => {
    const grey = (): [number, number, number, number] => [128, 128, 128, 255];
    const landscape = rgbaToThumbHash(40, 20, makeRgba(40, 20, grey));
    const portrait = rgbaToThumbHash(20, 40, makeRgba(20, 40, grey));
    expect(thumbHashToApproximateAspectRatio(landscape)).toBeGreaterThan(1);
    expect(thumbHashToApproximateAspectRatio(portrait)).toBeLessThan(1);
  });

  it("recovers a coarse left/right split (DCT carries low-frequency structure)", () => {
    const w = 32;
    const h = 16;
    // Left half red, right half blue.
    const hash = rgbaToThumbHash(
      w,
      h,
      makeRgba(w, h, (x) => (x < w / 2 ? [200, 30, 30, 255] : [30, 30, 200, 255])),
    );
    const out = thumbHashToRGBA(hash);
    // Sample the decoded left vs right columns: left should be redder, right bluer.
    const at = (px: number, py: number, c: number) => out.rgba[(py * out.w + px) * 4 + c];
    const midY = Math.floor(out.h / 2);
    const leftR = at(1, midY, 0);
    const leftB = at(1, midY, 2);
    const rightR = at(out.w - 2, midY, 0);
    const rightB = at(out.w - 2, midY, 2);
    expect(leftR).toBeGreaterThan(leftB);
    expect(rightB).toBeGreaterThan(rightR);
  });

  it("flags alpha and recovers a transparent/opaque split", () => {
    const w = 16;
    const h = 16;
    const opaque = rgbaToThumbHash(
      w,
      h,
      makeRgba(w, h, () => [100, 150, 200, 255]),
    );
    const translucent = rgbaToThumbHash(
      w,
      h,
      makeRgba(w, h, (x) => [100, 150, 200, x < w / 2 ? 0 : 255]),
    );
    // The hasAlpha header bit (bit 23 → bit 7 of byte 2) distinguishes them.
    expect(opaque[2] & 0x80).toBe(0);
    expect(translucent[2] & 0x80).not.toBe(0);
    // And the decoded alpha actually varies left (transparent) → right (opaque).
    const out = thumbHashToRGBA(translucent);
    const midY = Math.floor(out.h / 2);
    const leftA = out.rgba[(midY * out.w + 1) * 4 + 3];
    const rightA = out.rgba[(midY * out.w + (out.w - 2)) * 4 + 3];
    expect(rightA).toBeGreaterThan(leftA);
  });
});

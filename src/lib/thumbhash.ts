/**
 * Thumbhash — compact (~25 byte) blurred image preview.
 *
 * Vendored from Evan Wallace's reference implementation (MIT):
 *   https://github.com/evanw/thumbhash  (js/thumbhash.js)
 *
 * Why vendored instead of the npm package: it's a tiny, stable, dependency-free
 * algorithm, and inlining it keeps the concurrently-edited `package.json` /
 * `pnpm-lock.yaml` untouched (this branch had a large in-flight electron-builder
 * change in the lockfile). Matches the PRD guide's "prefer home-grown, don't add
 * a runtime owner" rule. We only ever encode AND decode with this same module —
 * no external interop — so the contract is internal consistency.
 *
 * Trimmed to what MUZERO needs: `rgbaToThumbHash` (encode at cover-set),
 * `thumbHashToRGBA` (decode → pixels for a canvas preview), and the aspect-ratio
 * helper. The PNG/data-URL helper from upstream is intentionally omitted — the UI
 * renders the decoded RGBA via a canvas (see `CoverImage`).
 *
 * @license MIT — Copyright (c) 2023 Evan Wallace
 */

/**
 * Encode an RGBA image (max 100×100) to a Thumbhash byte array.
 * `rgba` is row-major, 4 bytes/pixel.
 */
export function rgbaToThumbHash(
  w: number,
  h: number,
  rgba: Uint8Array | Uint8ClampedArray,
): Uint8Array {
  if (w > 100 || h > 100) throw new Error(`${w}x${h} doesn't fit in 100x100`);

  // Determine the average color (premultiplied by alpha).
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgA = 0;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    avgR += (alpha / 255) * rgba[j];
    avgG += (alpha / 255) * rgba[j + 1];
    avgB += (alpha / 255) * rgba[j + 2];
    avgA += alpha;
  }
  if (avgA > 0) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }

  const hasAlpha = avgA < w * h;
  const lLimit = hasAlpha ? 5 : 7; // fewer luminance bits when alpha is present
  const lx = Math.max(1, Math.round((lLimit * w) / Math.max(w, h)));
  const ly = Math.max(1, Math.round((lLimit * h) / Math.max(w, h)));
  const l: number[] = []; // luminance
  const p: number[] = []; // yellow - blue
  const q: number[] = []; // red - green
  const a: number[] = []; // alpha

  // RGBA → LPQA, compositing atop the average color.
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const alpha = rgba[j + 3] / 255;
    const r = avgR * (1 - alpha) + (alpha / 255) * rgba[j];
    const g = avgG * (1 - alpha) + (alpha / 255) * rgba[j + 1];
    const b = avgB * (1 - alpha) + (alpha / 255) * rgba[j + 2];
    l[i] = (r + g + b) / 3;
    p[i] = (r + g) / 2 - b;
    q[i] = r - g;
    a[i] = alpha;
  }

  // DCT → DC (constant) + normalized AC (varying) terms.
  const encodeChannel = (channel: number[], nx: number, ny: number): [number, number[], number] => {
    let dc = 0;
    const ac: number[] = [];
    let scale = 0;
    const fx: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx++) {
        let f = 0;
        for (let x = 0; x < w; x++) fx[x] = Math.cos((Math.PI / w) * cx * (x + 0.5));
        for (let y = 0; y < h; y++) {
          const fy = Math.cos((Math.PI / h) * cy * (y + 0.5));
          for (let x = 0; x < w; x++) f += channel[x + y * w] * fx[x] * fy;
        }
        f /= w * h;
        if (cx || cy) {
          ac.push(f);
          scale = Math.max(scale, Math.abs(f));
        } else {
          dc = f;
        }
      }
    }
    if (scale > 0) for (let i = 0; i < ac.length; i++) ac[i] = 0.5 + (0.5 / scale) * ac[i];
    return [dc, ac, scale];
  };
  const [lDc, lAc, lScale] = encodeChannel(l, Math.max(3, lx), Math.max(3, ly));
  const [pDc, pAc, pScale] = encodeChannel(p, 3, 3);
  const [qDc, qAc, qScale] = encodeChannel(q, 3, 3);
  const [aDc, aAc, aScale] = hasAlpha ? encodeChannel(a, 5, 5) : [1, [], 1];

  // Pack the constants.
  const isLandscape = w > h;
  const header24 =
    Math.round(63 * lDc) |
    (Math.round(31.5 + 31.5 * pDc) << 6) |
    (Math.round(31.5 + 31.5 * qDc) << 12) |
    (Math.round(31 * lScale) << 18) |
    ((hasAlpha ? 1 : 0) << 23);
  const header16 =
    (isLandscape ? ly : lx) |
    (Math.round(63 * pScale) << 3) |
    (Math.round(63 * qScale) << 9) |
    ((isLandscape ? 1 : 0) << 15);
  const hash = [
    header24 & 255,
    (header24 >> 8) & 255,
    header24 >> 16,
    header16 & 255,
    header16 >> 8,
  ];
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  if (hasAlpha) hash.push(Math.round(15 * aDc) | (Math.round(15 * aScale) << 4));

  // Pack the varying factors (4 bits each).
  const acChannels = hasAlpha ? [lAc, pAc, qAc, aAc] : [lAc, pAc, qAc];
  for (const ac of acChannels) {
    for (const f of ac) {
      const idx = acStart + (acIndex >> 1);
      hash[idx] = (hash[idx] ?? 0) | (Math.round(15 * f) << ((acIndex++ & 1) << 2));
    }
  }

  return new Uint8Array(hash);
}

/** Approximate the encoded image's aspect ratio (w/h) from the hash header. */
export function thumbHashToApproximateAspectRatio(hash: Uint8Array): number {
  const header = hash[3];
  const hasAlpha = hash[2] & 0x80;
  const isLandscape = hash[4] & 0x80;
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = isLandscape ? header & 7 : hasAlpha ? 5 : 7;
  return lx / ly;
}

/** Decode a Thumbhash to a small RGBA image (≈32 px on the long edge). */
export function thumbHashToRGBA(hash: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const { PI, min, max, cos, round } = Math;

  // Unpack the constants.
  const header24 = hash[0] | (hash[1] << 8) | (hash[2] << 16);
  const header16 = hash[3] | (hash[4] << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = header16 >> 15;
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? (hash[5] & 15) / 15 : 1;
  const aScale = (hash[5] >> 4) / 15;

  // Unpack the varying factors (saturation boosted 1.25× to offset quantization).
  const acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number): number[] => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy++) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx++) {
        ac.push(
          (((hash[acStart + (acIndex >> 1)] >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale,
        );
      }
    }
    return ac;
  };
  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  // DCT → RGBA.
  const ratio = thumbHashToApproximateAspectRatio(hash);
  const w = round(ratio > 1 ? 32 : 32 * ratio);
  const h = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);
  const fx: number[] = [];
  const fy: number[] = [];
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      let l = lDc;
      let p = pDc;
      let q = qDc;
      let a = aDc;

      for (let cx = 0, n = max(lx, hasAlpha ? 5 : 3); cx < n; cx++)
        fx[cx] = cos((PI / w) * (x + 0.5) * cx);
      for (let cy = 0, n = max(ly, hasAlpha ? 5 : 3); cy < n; cy++)
        fy[cy] = cos((PI / h) * (y + 0.5) * cy);

      // L
      for (let cy = 0, j = 0; cy < ly; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx * ly < lx * (ly - cy); cx++, j++) l += lAc[j] * fx[cx] * fy2;
      }
      // P and Q
      for (let cy = 0, j = 0; cy < 3; cy++) {
        const fy2 = fy[cy] * 2;
        for (let cx = cy ? 0 : 1; cx < 3 - cy; cx++, j++) {
          const f = fx[cx] * fy2;
          p += pAc[j] * f;
          q += qAc[j] * f;
        }
      }
      // A
      if (hasAlpha) {
        for (let cy = 0, j = 0; cy < 5; cy++) {
          const fy2 = fy[cy] * 2;
          for (let cx = cy ? 0 : 1; cx < 5 - cy; cx++, j++) a += aAc[j] * fx[cx] * fy2;
        }
      }

      // LPQA → RGB.
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[i] = max(0, 255 * min(1, r));
      rgba[i + 1] = max(0, 255 * min(1, g));
      rgba[i + 2] = max(0, 255 * min(1, b));
      rgba[i + 3] = max(0, 255 * min(1, a));
    }
  }
  return { w, h, rgba };
}

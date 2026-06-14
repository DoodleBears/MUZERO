/**
 * Tiny QR encoder for short login URLs. It covers QR versions 1-5 in byte mode
 * with low error correction, enough for NetEase's `music.163.com/login?codekey=...`
 * URL while keeping login QR rendering fully local.
 */

const VERSION_INFO = [
  { version: 1, dataCodewords: 19, eccCodewords: 7, alignment: [] },
  { version: 2, dataCodewords: 34, eccCodewords: 10, alignment: [6, 18] },
  { version: 3, dataCodewords: 55, eccCodewords: 15, alignment: [6, 22] },
  { version: 4, dataCodewords: 80, eccCodewords: 20, alignment: [6, 26] },
  { version: 5, dataCodewords: 108, eccCodewords: 26, alignment: [6, 30] },
] as const;

const PAD_CODEWORDS = [0xec, 0x11] as const;
const FORMAT_MASK = 0x5412;
const FORMAT_GENERATOR = 0x537;
const MASK_PATTERN = 0;

export interface QrSvgOptions {
  margin?: number;
}

export function qrSvgDataUrl(text: string, options: QrSvgOptions = {}): string {
  const matrix = encodeQrMatrix(text);
  const margin = options.margin ?? 4;
  const size = matrix.length + margin * 2;
  const dark = matrix
    .flatMap((row, y) => row.map((cell, x) => (cell ? `M${x + margin} ${y + margin}h1v1h-1z` : "")))
    .filter(Boolean)
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><path fill="#fff" d="M0 0h${size}v${size}H0z"/><path fill="#000" d="${dark}"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = VERSION_INFO.find((v) => 4 + 8 + bytes.length * 8 <= v.dataCodewords * 8);
  if (!version) throw new Error("QR payload is too long");

  const data = makeDataCodewords(bytes, version.dataCodewords);
  const ecc = makeErrorCorrection(data, version.eccCodewords);
  const codewordBits = [...data, ...ecc].flatMap((byte) =>
    Array.from({ length: 8 }, (_, i) => ((byte >>> (7 - i)) & 1) !== 0),
  );

  const size = 21 + (version.version - 1) * 4;
  const modules = makeEmptyMatrix(size);
  const functions = makeEmptyMatrix(size);

  function setFunction(x: number, y: number, dark: boolean) {
    modules[y][x] = dark;
    functions[y][x] = true;
  }

  drawFinder(setFunction, size, 0, 0);
  drawFinder(setFunction, size, size - 7, 0);
  drawFinder(setFunction, size, 0, size - 7);
  drawTiming(setFunction, size);
  drawAlignment(setFunction, functions, version.alignment);
  setFunction(8, 4 * version.version + 9, true);
  reserveFormat(functions, size);
  drawData(modules, functions, codewordBits);
  drawFormat(modules, functions, size, formatBits(MASK_PATTERN));

  return modules;
}

function makeDataCodewords(bytes: Uint8Array, count: number): number[] {
  const bits: boolean[] = [];
  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);
  appendBits(bits, 0, Math.min(4, count * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(false);

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] ? 1 : 0);
    data.push(byte);
  }
  for (let i = 0; data.length < count; i++) data.push(PAD_CODEWORDS[i % PAD_CODEWORDS.length]);
  return data;
}

function appendBits(out: boolean[], value: number, length: number) {
  for (let i = length - 1; i >= 0; i--) out.push(((value >>> i) & 1) !== 0);
}

function makeEmptyMatrix(size: number): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false));
}

function drawFinder(
  setFunction: (x: number, y: number, dark: boolean) => void,
  size: number,
  left: number,
  top: number,
) {
  for (let dy = -1; dy <= 7; dy++) {
    for (let dx = -1; dx <= 7; dx++) {
      const x = left + dx;
      const y = top + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const inCore = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark =
        inCore &&
        (dx === 0 ||
          dx === 6 ||
          dy === 0 ||
          dy === 6 ||
          (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunction(x, y, dark);
    }
  }
}

function drawTiming(setFunction: (x: number, y: number, dark: boolean) => void, size: number) {
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    setFunction(6, i, dark);
    setFunction(i, 6, dark);
  }
}

function drawAlignment(
  setFunction: (x: number, y: number, dark: boolean) => void,
  functions: boolean[][],
  positions: readonly number[],
) {
  for (const cx of positions) {
    for (const cy of positions) {
      if (functions[cy]?.[cx]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          setFunction(cx + dx, cy + dy, distance === 2 || distance === 0);
        }
      }
    }
  }
}

function reserveFormat(functions: boolean[][], size: number) {
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      functions[8][i] = true;
      functions[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    functions[8][size - 1 - i] = true;
    functions[size - 1 - i][8] = true;
  }
}

function drawData(modules: boolean[][], functions: boolean[][], bits: boolean[]) {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right--;
    for (let vert = 0; vert < size; vert++) {
      const y = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        if (functions[y][x]) continue;
        const masked = (x + y) % 2 === 0;
        modules[y][x] = (bits[bitIndex++] ?? false) !== masked;
      }
    }
    upward = !upward;
  }
}

function drawFormat(modules: boolean[][], functions: boolean[][], size: number, bits: number) {
  const set = (x: number, y: number, i: number) => {
    modules[y][x] = ((bits >>> i) & 1) !== 0;
    functions[y][x] = true;
  };
  for (let i = 0; i <= 5; i++) set(8, i, i);
  set(8, 7, 6);
  set(8, 8, 7);
  set(7, 8, 8);
  for (let i = 9; i < 15; i++) set(14 - i, 8, i);
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, i);
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, i);
}

function formatBits(mask: number): number {
  const data = (0b01 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if (((rem >>> i) & 1) !== 0) rem ^= FORMAT_GENERATOR << (i - 10);
  }
  return ((data << 10) | rem) ^ FORMAT_MASK;
}

function makeErrorCorrection(data: number[], degree: number): number[] {
  const generator = reedSolomonGenerator(degree);
  const result = Array.from({ length: degree }, () => 0);
  for (const value of data) {
    const factor = value ^ (result.shift() ?? 0);
    result.push(0);
    for (let i = 0; i < degree; i++) result[i] ^= gfMultiply(generator[i], factor);
  }
  return result;
}

function reedSolomonGenerator(degree: number): number[] {
  let result = [1];
  for (let i = 0; i < degree; i++) {
    const next = Array.from({ length: result.length + 1 }, () => 0);
    for (let j = 0; j < result.length; j++) {
      next[j] ^= gfMultiply(result[j], 1);
      next[j + 1] ^= gfMultiply(result[j], gfPow(2, i));
    }
    result = next;
  }
  return result.slice(1);
}

function gfPow(x: number, power: number): number {
  let result = 1;
  for (let i = 0; i < power; i++) result = gfMultiply(result, x);
  return result;
}

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    if (((y >>> i) & 1) !== 0) z ^= x;
  }
  return z & 0xff;
}

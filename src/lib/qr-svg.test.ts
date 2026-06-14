import { describe, expect, it } from "vitest";
import { encodeQrMatrix, qrSvgDataUrl } from "./qr-svg";

describe("qr-svg", () => {
  it("encodes a NetEase login URL as a local SVG QR", () => {
    const url = "https://music.163.com/login?codekey=1234567890abcdef1234567890abcdef";
    const matrix = encodeQrMatrix(url);

    expect(matrix).toHaveLength(33); // version 4
    expect(matrix[0][0]).toBe(true);
    expect(matrix[3][3]).toBe(true);
    expect(matrix[7][7]).toBe(false); // finder separator

    const dataUrl = qrSvgDataUrl(url);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(dataUrl)).toContain('shape-rendering="crispEdges"');
  });
});

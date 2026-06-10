import { describe, expect, it } from "vitest";
import {
  mapBiliQrStatus,
  mapNeteaseQrStatus,
  neteaseQrContent,
  parseBiliQrGenerate,
  parseNeteaseUnikey,
} from "./qr-login";

describe("netease QR", () => {
  it("parses the unikey from the generate response", () => {
    expect(parseNeteaseUnikey({ code: 200, unikey: "abc123" })).toBe("abc123");
    expect(parseNeteaseUnikey({ code: 200 })).toBeNull();
    expect(parseNeteaseUnikey("not json" as unknown)).toBeNull();
  });

  it("builds the QR content URL from the unikey", () => {
    expect(neteaseQrContent("abc123")).toBe("https://music.163.com/login?codekey=abc123");
  });

  it("maps the documented poll codes to a unified status", () => {
    expect(mapNeteaseQrStatus(801)).toBe("waiting");
    expect(mapNeteaseQrStatus(802)).toBe("scanned");
    expect(mapNeteaseQrStatus(803)).toBe("success");
    expect(mapNeteaseQrStatus(800)).toBe("expired");
    expect(mapNeteaseQrStatus(-1)).toBe("waiting"); // unknown → keep polling
  });
});

describe("bili QR", () => {
  it("parses url + qrcode_key from the generate response", () => {
    expect(
      parseBiliQrGenerate({
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?...",
          qrcode_key: "k1",
        },
      }),
    ).toEqual({
      qrKey: "k1",
      qrContent: "https://passport.bilibili.com/h5-app/passport/login/scan?...",
    });
    expect(parseBiliQrGenerate({ code: -400, data: null })).toBeNull();
  });

  it("maps the documented poll codes (in data.code) to a unified status", () => {
    expect(mapBiliQrStatus({ code: 0, data: { code: 86101 } })).toBe("waiting");
    expect(mapBiliQrStatus({ code: 0, data: { code: 86090 } })).toBe("scanned");
    expect(mapBiliQrStatus({ code: 0, data: { code: 0 } })).toBe("success");
    expect(mapBiliQrStatus({ code: 0, data: { code: 86038 } })).toBe("expired");
    expect(mapBiliQrStatus({ code: 0, data: { code: 99999 } })).toBe("waiting");
    expect(mapBiliQrStatus({})).toBe("waiting");
  });
});

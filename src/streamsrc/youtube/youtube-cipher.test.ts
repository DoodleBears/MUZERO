import { describe, expect, it } from "vitest";
import { type CipherSolvers, parseSignatureCipher, resolveFormatUrl } from "./youtube-cipher";

// Stub solvers: reverse the signature, uppercase the n param — deterministic + visible.
const solvers: CipherSolvers = {
  solveSig: (s) => s.split("").reverse().join(""),
  solveN: (n) => n.toUpperCase(),
};

describe("parseSignatureCipher", () => {
  it("splits s / sp / url out of the cipher query", () => {
    const cipher = `s=ABCDEF&sp=sig&url=${encodeURIComponent("https://cdn.example/vid?n=throttle&itag=140")}`;
    expect(parseSignatureCipher(cipher)).toEqual({
      s: "ABCDEF",
      sp: "sig",
      url: "https://cdn.example/vid?n=throttle&itag=140",
    });
  });

  it("defaults sp to 'signature' and rejects a cipher with no s/url", () => {
    expect(parseSignatureCipher(`s=X&url=${encodeURIComponent("https://c/v")}`)?.sp).toBe(
      "signature",
    );
    expect(parseSignatureCipher("sp=sig")).toBeNull();
  });
});

describe("resolveFormatUrl", () => {
  it("descrambles the signature, attaches it, and transforms n (ciphered format)", () => {
    const url = "https://cdn.example/vid?itag=251&n=throttle";
    const format = { signatureCipher: `s=ABCDEF&sp=sig&url=${encodeURIComponent(url)}` };
    const out = resolveFormatUrl(format, solvers);
    expect(out).not.toBeNull();
    const params = new URL(out as string).searchParams;
    expect(params.get("sig")).toBe("FEDCBA"); // reversed signature
    expect(params.get("n")).toBe("THROTTLE"); // transformed n
  });

  it("only transforms n for a non-ciphered (direct url) format", () => {
    const out = resolveFormatUrl({ url: "https://cdn.example/vid?itag=140&n=abc" }, solvers);
    expect(new URL(out as string).searchParams.get("n")).toBe("ABC");
  });

  it("leaves a url without an n param untouched aside from the signature", () => {
    const out = resolveFormatUrl({ url: "https://cdn.example/vid?itag=140" }, solvers);
    expect(out).toBe("https://cdn.example/vid?itag=140");
  });

  it("returns null when the format has neither url nor a valid cipher", () => {
    expect(resolveFormatUrl({}, solvers)).toBeNull();
    expect(resolveFormatUrl({ signatureCipher: "sp=sig" }, solvers)).toBeNull();
  });
});

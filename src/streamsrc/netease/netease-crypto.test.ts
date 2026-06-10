import { createCipheriv, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EAPI_KEY,
  eapiEncrypt,
  PRESET_KEY,
  randomSecretKey,
  WEAPI_IV,
  weapiDecryptForTest,
  weapiEncrypt,
} from "./netease-crypto";

/**
 * NetEase weapi/eapi are reimplemented here in browser-safe primitives
 * (`@noble/ciphers` + hand-rolled md5/rsa). These tests cross-check against Node's
 * independent `node:crypto` (different AES + MD5 implementation) so an agreement is
 * real evidence, not a tautology. Node is test-only — the module never imports it.
 */

// Reference eapi using Node crypto, mirroring the documented algorithm.
function eapiReference(apiPath: string, text: string): string {
  const digest = createHash("md5").update(`nobody${apiPath}use${text}md5forencrypt`).digest("hex");
  const data = `${apiPath}-36cd479b6b5-${text}-36cd479b6b5-${digest}`;
  const cipher = createCipheriv("aes-128-ecb", Buffer.from(EAPI_KEY, "utf8"), null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(data, "utf8"), cipher.final()])
    .toString("hex")
    .toUpperCase();
}

function cbcBase64Reference(key: string, ivStr: string, text: string): string {
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(key, "utf8"),
    Buffer.from(ivStr, "utf8"),
  );
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString("base64");
}

describe("eapiEncrypt", () => {
  it("matches a Node-crypto reference (AES-128-ECB + md5 digest, uppercase hex)", () => {
    const path = "/api/song/enhance/player/url/v1";
    const text = JSON.stringify({ ids: "[123]", level: "lossless", encodeType: "flac" });
    expect(eapiEncrypt(path, text).params).toBe(eapiReference(path, text));
  });

  it("is uppercase hex of even length", () => {
    const { params } = eapiEncrypt("/api/x", "{}");
    expect(params).toMatch(/^[0-9A-F]+$/);
    expect(params.length % 2).toBe(0);
  });
});

describe("weapiEncrypt", () => {
  const key = "abcdefghijklmnop"; // fixed 16-char key so the result is deterministic
  const text = JSON.stringify({ s: "周杰伦", type: "1" });

  it("double-CBC-encrypts (preset then random key) matching a Node reference", () => {
    const inner = cbcBase64Reference(PRESET_KEY, WEAPI_IV, text);
    const expectedParams = cbcBase64Reference(key, WEAPI_IV, inner);
    expect(weapiEncrypt(text, key).params).toBe(expectedParams);
  });

  it("round-trips: decrypt(params) → inner → original text", () => {
    const { params } = weapiEncrypt(text, key);
    expect(weapiDecryptForTest(params, key)).toBe(text);
  });

  it("produces a 256-hex encSecKey", () => {
    expect(weapiEncrypt(text, key).encSecKey).toMatch(/^[0-9a-f]{256}$/);
  });

  it("is deterministic for a fixed key but varies with the key", () => {
    expect(weapiEncrypt(text, key).params).toBe(weapiEncrypt(text, key).params);
    expect(weapiEncrypt(text, key).params).not.toBe(weapiEncrypt(text, "ponmlkjihgfedcba").params);
  });
});

describe("randomSecretKey", () => {
  it("returns 16 chars from the expected alphabet", () => {
    for (let i = 0; i < 20; i += 1) {
      const k = randomSecretKey();
      expect(k).toHaveLength(16);
      expect(k).toMatch(/^[A-Za-z0-9]{16}$/);
    }
  });
});

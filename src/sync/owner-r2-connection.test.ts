import { describe, expect, it } from "vitest";
import { buildOwnerR2Connection, parseR2AccountId } from "./owner-r2-connection";

describe("parseR2AccountId", () => {
  it("extracts the account id from an S3 API endpoint URL", () => {
    expect(parseR2AccountId("https://abc123def.r2.cloudflarestorage.com")).toBe("abc123def");
    expect(parseR2AccountId("https://abc123def.r2.cloudflarestorage.com/")).toBe("abc123def");
  });

  it("passes a bare account id through (trimmed)", () => {
    expect(parseR2AccountId("  abc123def  ")).toBe("abc123def");
  });
});

describe("buildOwnerR2Connection", () => {
  it("builds whole-bucket credentials + derived manifest URL from a minimal input", () => {
    const result = buildOwnerR2Connection({
      endpointOrAccountId: "https://acct.r2.cloudflarestorage.com",
      bucket: "muzero",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      publicUrl: "https://pub-x.r2.dev",
    });

    expect(result.credentials).toEqual({
      accountId: "acct",
      bucket: "muzero",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    });
    // "Occupy the whole bucket" — no prefix.
    expect(result.credentials.prefix).toBeUndefined();
    expect(result.publicBaseUrl).toBe("https://pub-x.r2.dev/");
    expect(result.manifestUrl).toBe("https://pub-x.r2.dev/manifest.json");
  });

  it("accepts a bare account id and a public URL that already points at a manifest", () => {
    const result = buildOwnerR2Connection({
      endpointOrAccountId: "acct",
      bucket: "muzero",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
      publicUrl: "https://music.example.com/muzero/manifest.json",
    });

    expect(result.credentials.accountId).toBe("acct");
    expect(result.publicBaseUrl).toBe("https://music.example.com/muzero/");
    expect(result.manifestUrl).toBe("https://music.example.com/muzero/manifest.json");
  });

  it("trims credential fields", () => {
    const result = buildOwnerR2Connection({
      endpointOrAccountId: "acct",
      bucket: "  muzero  ",
      accessKeyId: "  AKID  ",
      secretAccessKey: "  SECRET  ",
      publicUrl: "https://pub-x.r2.dev",
    });
    expect(result.credentials).toMatchObject({
      bucket: "muzero",
      accessKeyId: "AKID",
      secretAccessKey: "SECRET",
    });
  });
});

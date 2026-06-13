import { describe, expect, it } from "vitest";
import { canServeLocalCover } from "./local-cover";

describe("canServeLocalCover", () => {
  it("is true only for a file-backed cover with a storage key", () => {
    expect(
      canServeLocalCover({ storageBackend: "electron-file", storageKey: "cover/x__blb.jpg" }),
    ).toBe(true);
  });

  it("is false for OPFS or IndexedDB backends (no local file to serve)", () => {
    expect(canServeLocalCover({ storageBackend: "opfs", storageKey: "cover/x.jpg" })).toBe(false);
    expect(canServeLocalCover({ storageBackend: "indexeddb" })).toBe(false);
  });

  it("is false when the storage key is missing", () => {
    expect(canServeLocalCover({ storageBackend: "electron-file" })).toBe(false);
    expect(canServeLocalCover({ storageBackend: "electron-file", storageKey: "" })).toBe(false);
  });

  it("is false for undefined / no blob", () => {
    expect(canServeLocalCover(undefined)).toBe(false);
    expect(canServeLocalCover(null)).toBe(false);
  });
});

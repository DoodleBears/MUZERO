import { describe, expect, it } from "vitest";
import { QQ_QUALITY_TIERS, qqFilename, qqQualityCandidates } from "./qq-quality";

describe("QQ_QUALITY_TIERS", () => {
  it("lists only plaintext tiers (no .mflac/.mgg, no encrypted *M0 prefix)", () => {
    for (const t of QQ_QUALITY_TIERS) {
      expect(t.ext).not.toMatch(/mflac|mgg/);
      expect(t.prefix).not.toMatch(/M0$/); // encrypted prefixes end in M0 (F0M0/O8M0…)
    }
    expect(QQ_QUALITY_TIERS.map((t) => t.key)).toEqual(["flac", "320", "m4a", "128"]);
  });
});

describe("qqQualityCandidates", () => {
  it("returns the full best→worst list for undefined / unknown / flac", () => {
    expect(qqQualityCandidates().map((t) => t.key)).toEqual(["flac", "320", "m4a", "128"]);
    expect(qqQualityCandidates("nope").map((t) => t.key)).toEqual(["flac", "320", "m4a", "128"]);
    expect(qqQualityCandidates("flac").map((t) => t.key)).toEqual(["flac", "320", "m4a", "128"]);
  });
  it("drops tiers above the preferred one", () => {
    expect(qqQualityCandidates("320").map((t) => t.key)).toEqual(["320", "m4a", "128"]);
    expect(qqQualityCandidates("128").map((t) => t.key)).toEqual(["128"]);
  });
});

describe("qqFilename", () => {
  it("duplicates the media mid between prefix and ext", () => {
    expect(qqFilename(QQ_QUALITY_TIERS[0], "ABC")).toBe("F000ABCABC.flac");
    expect(qqFilename(QQ_QUALITY_TIERS[1], "X")).toBe("M800XX.mp3");
  });
});

import { describe, expect, it } from "vitest";
import {
  parseReleaseManifest,
  type ReleaseManifest,
  releaseManifestSchema,
} from "@/lib/release-manifest-schema";

const VALID: ReleaseManifest = {
  schema: "muzero-release-manifest-v1",
  productName: "MUZERO",
  latest: "0.7.0",
  updatedAt: "2026-06-11T00:00:00.000Z",
  releases: [
    {
      version: "0.7.0",
      date: "2026-06-11",
      channel: "stable",
      notesRef: "0.7.0",
      platforms: {
        "mac-arm64": {
          file: "0.7.0/MUZERO-0.7.0-arm64.dmg",
          url: "https://assets.mu0.app/desktop/0.7.0/MUZERO-0.7.0-arm64.dmg",
          size: 1234567,
          sha256: "abc123",
        },
      },
    },
  ],
};

describe("releaseManifestSchema", () => {
  it("accepts a well-formed manifest", () => {
    expect(() => parseReleaseManifest(VALID)).not.toThrow();
  });

  it("rejects a wrong schema tag", () => {
    expect(() => parseReleaseManifest({ ...VALID, schema: "something-else" })).toThrow();
  });

  it("rejects an unknown platform key", () => {
    const bad = {
      ...VALID,
      releases: [
        {
          ...VALID.releases[0],
          platforms: { "mac-ppc": VALID.releases[0].platforms["mac-arm64"] },
        },
      ],
    };
    expect(() => parseReleaseManifest(bad)).toThrow();
  });

  it("defaults channel to stable", () => {
    const parsed = releaseManifestSchema.parse({
      ...VALID,
      releases: [
        {
          version: "0.7.0",
          date: "2026-06-11",
          notesRef: "0.7.0",
          platforms: {},
        },
      ],
    });
    expect(parsed.releases[0].channel).toBe("stable");
  });
});

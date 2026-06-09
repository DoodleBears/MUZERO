import { describe, expect, it } from "vitest";
import { cacheMetadataVersion, canUseUpdatedAtWinner } from "./r2-merge-policy";

describe("R2 merge policy", () => {
  it("allows latest updatedAt auto-wins only for cache metadata", () => {
    expect(canUseUpdatedAtWinner("cache-metadata")).toBe(true);
    expect(canUseUpdatedAtWinner("user-authored")).toBe(false);
  });

  it("derives page versions from non-user-authored cache metadata", () => {
    expect(cacheMetadataVersion("catalog/tracks-page-0001.json")).toBeUndefined();
    expect(cacheMetadataVersion({ path: "catalog/tracks-page-0001.json", updatedAt: "t1" })).toBe(
      "t1",
    );
    expect(
      cacheMetadataVersion({
        path: "catalog/tracks-page-0001.json",
        updatedAt: "t1",
        etag: "etag-1",
      }),
    ).toBe("etag-1");
    expect(
      cacheMetadataVersion({
        path: "catalog/tracks-page-0001.json",
        updatedAt: "t1",
        etag: "etag-1",
        sha256: "sha-1",
      }),
    ).toBe("sha-1");
  });
});

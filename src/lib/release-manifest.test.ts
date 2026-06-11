import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("@/lib/platform", () => ({
  getAppFetch: () => Promise.resolve(fetchMock),
}));

import { currentOsFamily, fetchReleaseManifest, platformMatchesOs } from "@/lib/release-manifest";

const MANIFEST = {
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
          file: "0.7.0/a.dmg",
          url: "https://assets.mu0.app/desktop/0.7.0/a.dmg",
          size: 10,
          sha256: "x",
        },
      },
    },
  ],
};

beforeEach(() => fetchMock.mockReset());

describe("fetchReleaseManifest", () => {
  it("fetches via getAppFetch and validates with the schema", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => MANIFEST });
    const m = await fetchReleaseManifest();
    expect(m.latest).toBe("0.7.0");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://assets.mu0.app/desktop/manifest.json",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(fetchReleaseManifest()).rejects.toThrow(/404/);
  });

  it("throws on a malformed manifest", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ schema: "nope" }) });
    await expect(fetchReleaseManifest()).rejects.toThrow();
  });
});

describe("currentOsFamily / platformMatchesOs", () => {
  it("detects the family from a user-agent string", () => {
    expect(currentOsFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X)")).toBe("mac");
    expect(currentOsFamily("Mozilla/5.0 (Windows NT 10.0)")).toBe("win");
    expect(currentOsFamily("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  it("matches platform keys to OS families", () => {
    expect(platformMatchesOs("mac-arm64", "mac")).toBe(true);
    expect(platformMatchesOs("win-x64", "mac")).toBe(false);
    expect(platformMatchesOs("linux-x64-deb", "linux")).toBe(true);
  });
});

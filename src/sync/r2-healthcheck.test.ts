import { describe, expect, it } from "vitest";
import {
  buildRecommendedR2Cors,
  checkR2PublicRead,
  checkR2WriteAccess,
  maskSecret,
} from "./r2-healthcheck";

const manifest = {
  schema: "muzero-r2-manifest-v1",
  libraryId: "lib_demo",
  title: "Demo Library",
  baseUrl: "https://music.example.com/muzero/",
  createdAt: "2026-06-09T00:00:00.000Z",
  updatedAt: "2026-06-09T00:00:00.000Z",
  sets: [
    {
      id: "set_1",
      title: "Night Drive",
      index: "sets/set_1/index.json",
      updatedAt: "2026-06-09T00:00:00.000Z",
      trackCount: 3,
      bytes: 4096,
    },
  ],
};

describe("checkR2PublicRead", () => {
  it("validates a public manifest without mutating local state", async () => {
    const result = await checkR2PublicRead("https://music.example.com/muzero/manifest.json", {
      fetcher: async (url) => {
        expect(url).toBe("https://music.example.com/muzero/manifest.json");
        return Response.json(manifest);
      },
    });

    expect(result.ok).toBe(true);
    expect(result.preview?.title).toBe("Demo Library");
    expect(result.checks.map((check) => check.id)).toEqual(["manifest-url", "manifest-fetch"]);
  });

  it("returns an actionable CORS/network error", async () => {
    const result = await checkR2PublicRead("https://music.example.com/muzero/manifest.json", {
      fetcher: async () => {
        throw new TypeError("Failed to fetch");
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({
      id: "manifest-fetch",
      status: "failed",
    });
    expect(result.hint).toContain("CORS");
  });

  it("rejects invalid manifests", async () => {
    const result = await checkR2PublicRead("https://music.example.com/muzero/manifest.json", {
      fetcher: async () => Response.json({ schema: "wrong" }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({
      id: "manifest-schema",
      status: "failed",
    });
  });
});

describe("checkR2WriteAccess", () => {
  it("probes PUT, HEAD, and DELETE using signed S3-compatible requests", async () => {
    const seen: Array<{ method: string; url: string; authorization: string | null }> = [];

    const result = await checkR2WriteAccess(
      {
        accountId: "abc123",
        bucket: "muzero",
        accessKeyId: "key",
        secretAccessKey: "secret",
        prefix: "library",
      },
      {
        now: () => new Date("2026-06-09T01:02:03.000Z"),
        fetcher: async (url, init) => {
          seen.push({
            method: init?.method ?? "GET",
            url: String(url),
            authorization: new Headers(init?.headers).get("authorization"),
          });
          return new Response(null, { status: init?.method === "HEAD" ? 200 : 204 });
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(seen.map((request) => request.method)).toEqual(["PUT", "HEAD", "DELETE"]);
    expect(seen[0]?.url).toBe(
      "https://abc123.r2.cloudflarestorage.com/muzero/library/.muzero-healthcheck.json",
    );
    expect(seen.every((request) => request.authorization?.startsWith("AWS4-HMAC-SHA256"))).toBe(
      true,
    );
  });

  it("does not leak secrets in failed write results", async () => {
    const result = await checkR2WriteAccess(
      {
        accountId: "abc123",
        bucket: "muzero",
        accessKeyId: "key",
        secretAccessKey: "super-secret-value",
      },
      {
        fetcher: async () => new Response("nope", { status: 403 }),
      },
    );

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
  });
});

describe("R2 setup helpers", () => {
  it("builds copyable browser CORS JSON for public read and owner writes", () => {
    expect(buildRecommendedR2Cors("https://mu0.app")).toEqual([
      {
        AllowedOrigins: ["https://mu0.app"],
        AllowedMethods: ["GET", "HEAD", "PUT", "DELETE"],
        AllowedHeaders: ["authorization", "content-type", "x-amz-content-sha256", "x-amz-date"],
        ExposeHeaders: ["etag"],
        MaxAgeSeconds: 3600,
      },
    ]);
  });

  it("masks secret-like values for UI display", () => {
    expect(maskSecret("abc123456789")).toBe("abc1••••6789");
    expect(maskSecret("tiny")).toBe("••••");
  });
});

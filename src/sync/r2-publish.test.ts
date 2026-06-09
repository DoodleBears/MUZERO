import { describe, expect, it } from "vitest";
import type { R2ExportPlan } from "./r2-export-plan";
import { publishR2ExportPlan } from "./r2-publish";

const plan: R2ExportPlan = {
  driveId: "drv_1",
  libraryId: "lib_1",
  baseUrl: "https://music.example.com/muzero/",
  totalBytes: 16,
  objects: [
    {
      kind: "media",
      key: "objects/media/sha256-a.mp3",
      contentType: "audio/mpeg",
      bytes: 3,
      body: new Blob(["abc"], { type: "audio/mpeg" }),
      sha256: "a",
      setId: "ses_1",
      trackId: "trk_1",
    },
    {
      kind: "set-index",
      key: "sets/ses_1/index.json",
      contentType: "application/json",
      bytes: 6,
      body: "{}\n",
      setId: "ses_1",
    },
    {
      kind: "manifest",
      key: "manifest.json",
      contentType: "application/json",
      bytes: 7,
      body: "{}\n",
    },
  ],
};

const credentials = {
  accountId: "abc123",
  bucket: "muzero",
  accessKeyId: "key",
  secretAccessKey: "secret",
  prefix: "library",
};

describe("publishR2ExportPlan", () => {
  it("uploads binary objects before set indexes and root manifest", async () => {
    const seen: Array<{ method: string; url: string; authorization: string | null }> = [];

    const result = await publishR2ExportPlan(plan, credentials, {
      fetcher: async (url, init) => {
        seen.push({
          method: init?.method ?? "GET",
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
        });
        return new Response(null, { status: init?.method === "HEAD" ? 404 : 204 });
      },
      now: () => new Date("2026-06-09T01:02:03.000Z"),
    });

    expect(result).toMatchObject({ uploaded: 3, skipped: 0, failed: 0 });
    expect(seen.map((request) => request.method)).toEqual(["HEAD", "PUT", "PUT", "PUT"]);
    expect(seen.map((request) => request.url)).toEqual([
      "https://abc123.r2.cloudflarestorage.com/muzero/library/objects/media/sha256-a.mp3",
      "https://abc123.r2.cloudflarestorage.com/muzero/library/objects/media/sha256-a.mp3",
      "https://abc123.r2.cloudflarestorage.com/muzero/library/sets/ses_1/index.json",
      "https://abc123.r2.cloudflarestorage.com/muzero/library/manifest.json",
    ]);
    expect(seen.every((request) => request.authorization?.startsWith("AWS4-HMAC-SHA256"))).toBe(
      true,
    );
  });

  it("skips content-addressed binary objects that already exist", async () => {
    const seen: string[] = [];

    const result = await publishR2ExportPlan(plan, credentials, {
      fetcher: async (_url, init) => {
        seen.push(init?.method ?? "GET");
        return new Response(null, { status: init?.method === "HEAD" ? 200 : 204 });
      },
    });

    expect(result).toMatchObject({ uploaded: 2, skipped: 1, failed: 0 });
    expect(seen).toEqual(["HEAD", "PUT", "PUT"]);
  });

  it("can cancel between objects", async () => {
    const controller = new AbortController();
    const seen: string[] = [];

    await expect(
      publishR2ExportPlan(plan, credentials, {
        signal: controller.signal,
        fetcher: async (_url, init) => {
          seen.push(init?.method ?? "GET");
          return new Response(null, { status: init?.method === "HEAD" ? 404 : 204 });
        },
        onProgress: (event) => {
          if (event.object.key === "objects/media/sha256-a.mp3" && event.status === "uploaded") {
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(seen).toEqual(["HEAD", "PUT"]);
  });

  it("does not publish the root manifest when an earlier referenced object fails", async () => {
    const seen: string[] = [];

    await expect(
      publishR2ExportPlan(plan, credentials, {
        fetcher: async (url, init) => {
          seen.push(`${init?.method ?? "GET"} ${String(url)}`);
          if (String(url).endsWith("/sets/ses_1/index.json")) {
            return new Response(null, { status: 500 });
          }
          return new Response(null, { status: init?.method === "HEAD" ? 404 : 204 });
        },
      }),
    ).rejects.toThrow("Failed to upload sets/ses_1/index.json");

    expect(seen.some((request) => request.endsWith("/manifest.json"))).toBe(false);
  });

  it("sends conditional write headers for mutable JSON objects", async () => {
    const guardedPlan: R2ExportPlan = {
      ...plan,
      objects: [
        {
          kind: "set-index",
          key: "sets/ses_1/index.json",
          contentType: "application/json",
          bytes: 6,
          body: "{}\n",
          setId: "ses_1",
          precondition: { ifMatch: '"etag-1"' },
        },
      ],
      totalBytes: 6,
    };
    const seen: Array<{ ifMatch: string | null; authorization: string | null }> = [];

    await publishR2ExportPlan(guardedPlan, credentials, {
      fetcher: async (_url, init) => {
        const headers = new Headers(init?.headers);
        seen.push({
          ifMatch: headers.get("if-match"),
          authorization: headers.get("authorization"),
        });
        return new Response(null, { status: 204 });
      },
      now: () => new Date("2026-06-09T01:02:03.000Z"),
    });

    expect(seen[0]).toMatchObject({ ifMatch: '"etag-1"' });
    expect(seen[0]?.authorization).toContain("if-match");
  });
});

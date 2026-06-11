import { waitFor } from "@testing-library/react";
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
  it("forwards the abort signal into every signed request (F6)", async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | null | undefined> = [];

    await publishR2ExportPlan(plan, credentials, {
      fetcher: async (_url, init) => {
        signals.push(init?.signal);
        return new Response(null, { status: init?.method === "HEAD" ? 404 : 204 });
      },
      signal: controller.signal,
    });

    // HEAD skip-checks and PUT uploads alike — an in-flight request must be
    // abortable, not just the gaps between objects.
    expect(signals.length).toBeGreaterThan(0);
    for (const signal of signals) expect(signal).toBe(controller.signal);
  });

  it("retries a transient 5xx upload with backoff before succeeding (F7)", async () => {
    const delays: number[] = [];
    let putAttempts = 0;

    const result = await publishR2ExportPlan(plan, credentials, {
      fetcher: async (_url, init) => {
        if (init?.method === "HEAD") return new Response(null, { status: 404 });
        putAttempts += 1;
        // First object fails twice with a 500, then everything succeeds.
        return new Response(null, { status: putAttempts <= 2 ? 500 : 204 });
      },
      retry: { sleep: async (ms) => void delays.push(ms) },
    });

    expect(result.uploaded).toBe(3);
    expect(result.failed).toBe(0);
    expect(putAttempts).toBe(5); // 3 objects + 2 retries of the first
    expect(delays).toEqual([500, 1000]); // exponential backoff
  });

  it("does not retry a non-transient 4xx and fails the publish (F7)", async () => {
    let putAttempts = 0;

    await expect(
      publishR2ExportPlan(plan, credentials, {
        fetcher: async (_url, init) => {
          if (init?.method === "HEAD") return new Response(null, { status: 404 });
          putAttempts += 1;
          return new Response(null, { status: 412 });
        },
        retry: { sleep: async () => {} },
      }),
    ).rejects.toThrow(/HTTP 412/);

    expect(putAttempts).toBe(1);
  });

  it("treats a failed HEAD probe as not-skippable instead of failing the publish (F7)", async () => {
    const result = await publishR2ExportPlan(plan, credentials, {
      fetcher: async (_url, init) => {
        if (init?.method === "HEAD") throw new Error("network down");
        return new Response(null, { status: 204 });
      },
    });

    expect(result.uploaded).toBe(3);
    expect(result.skipped).toBe(0);
  });

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

  it("uploads immutable objects concurrently but keeps JSON barriers ordered", async () => {
    const concurrentPlan: R2ExportPlan = {
      ...plan,
      totalBytes: 20,
      objects: [
        {
          kind: "media",
          key: "objects/media/sha256-a.mp3",
          contentType: "audio/mpeg",
          bytes: 3,
          body: new Blob(["abc"], { type: "audio/mpeg" }),
          sha256: "a",
        },
        {
          kind: "cover",
          key: "objects/covers/sha256-b.jpg",
          contentType: "image/jpeg",
          bytes: 4,
          body: new Blob(["bbbb"], { type: "image/jpeg" }),
          sha256: "b",
        },
        {
          kind: "set-index",
          key: "sets/ses_1/index.json",
          contentType: "application/json",
          bytes: 6,
          body: "{}\n",
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
    const seen: string[] = [];
    const activeEvents: number[] = [];
    let activePuts = 0;
    let peakPuts = 0;
    const releaseMediaPuts: Array<() => void> = [];

    const pending = publishR2ExportPlan(concurrentPlan, credentials, {
      uploadConcurrency: 2,
      skipExistingChecks: true,
      onProgress: (event) => {
        if (event.status === "uploading") activeEvents.push(event.activeUploads ?? 0);
      },
      fetcher: async (url, init) => {
        const request = `${init?.method ?? "GET"} ${String(url)}`;
        seen.push(request);
        if (request.includes("/objects/")) {
          activePuts += 1;
          peakPuts = Math.max(peakPuts, activePuts);
          await new Promise<void>((resolve) => releaseMediaPuts.push(resolve));
          activePuts -= 1;
        }
        return new Response(null, { status: 204 });
      },
    });

    await waitFor(() => expect(peakPuts).toBe(2));
    expect(seen.some((request) => request.includes("/sets/ses_1/index.json"))).toBe(false);
    for (const release of releaseMediaPuts) release();
    await pending;

    expect(activeEvents).toContain(2);
    const paths = seen.map((request) => new URL(request.split(" ")[1] ?? "").pathname);
    expect(paths.slice(0, 2).sort()).toEqual(
      [
        "/muzero/library/objects/covers/sha256-b.jpg",
        "/muzero/library/objects/media/sha256-a.mp3",
      ].sort(),
    );
    expect(paths.slice(2)).toEqual([
      "/muzero/library/sets/ses_1/index.json",
      "/muzero/library/manifest.json",
    ]);
    expect(paths.map((path) => path.replace("/muzero/library/", ""))).toEqual([
      expect.stringMatching(/^objects\/(covers\/sha256-b\.jpg|media\/sha256-a\.mp3)$/),
      expect.stringMatching(/^objects\/(covers\/sha256-b\.jpg|media\/sha256-a\.mp3)$/),
      "sets/ses_1/index.json",
      "manifest.json",
    ]);
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

  it("can skip HEAD existence checks for a first publish into an empty remote", async () => {
    const seen: string[] = [];

    const result = await publishR2ExportPlan(plan, credentials, {
      skipExistingChecks: true,
      fetcher: async (_url, init) => {
        seen.push(init?.method ?? "GET");
        return new Response(null, { status: 204 });
      },
    });

    expect(result).toMatchObject({ uploaded: 3, skipped: 0, failed: 0 });
    expect(seen).toEqual(["PUT", "PUT", "PUT"]);
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

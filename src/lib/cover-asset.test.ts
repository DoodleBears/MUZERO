import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRemoteCoverAssetCacheForTests,
  getOrFetchRemoteCoverAsset,
  remoteCoverAssetKey,
} from "@/lib/cover-asset";

beforeEach(() => {
  clearRemoteCoverAssetCacheForTests();
});

afterEach(() => {
  clearRemoteCoverAssetCacheForTests();
});

describe("remote cover assets", () => {
  it("fetches and validates an image once, then returns the cached asset", async () => {
    const fetcher = vi.fn(async () =>
      responseWithBlob(new Blob([new Uint8Array([1, 2, 3])]), "image/jpg; charset=utf-8"),
    );

    const first = await getOrFetchRemoteCoverAsset("https://example.com/cover.jpg", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    const second = await getOrFetchRemoteCoverAsset("https://example.com/cover.jpg", {
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(first).toBe(second);
    expect(first).toMatchObject({
      bytes: 3,
      cacheKey: remoteCoverAssetKey("https://example.com/cover.jpg"),
      mime: "image/jpeg",
      url: "https://example.com/cover.jpg",
    });
    expect(first.blob.type).toBe("image/jpeg");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://example.com/cover.jpg", {
      cache: "force-cache",
    });
  });

  it("joins concurrent requests for the same remote cover", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = getOrFetchRemoteCoverAsset("https://example.com/joined.png", {
      fetcher: fetcher as unknown as typeof fetch,
    });
    const second = getOrFetchRemoteCoverAsset("https://example.com/joined.png", {
      fetcher: fetcher as unknown as typeof fetch,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch(responseWithBlob(new Blob([new Uint8Array([4])]), "image/png"));

    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(a.mime).toBe("image/png");
  });

  it("rejects non-image responses", async () => {
    const fetcher = vi.fn(async () => responseWithBlob(new Blob(["html"]), "text/html"));

    await expect(
      getOrFetchRemoteCoverAsset("https://example.com/not-image", {
        fetcher: fetcher as unknown as typeof fetch,
      }),
    ).rejects.toThrow("remote cover response is not an image");
  });
});

function responseWithBlob(blob: Blob, contentType: string | null): Response {
  return {
    blob: async () => blob,
    headers: {
      get: (name: string) => (name.toLowerCase() === "content-type" ? contentType : null),
    },
    ok: true,
    status: 200,
  } as Response;
}

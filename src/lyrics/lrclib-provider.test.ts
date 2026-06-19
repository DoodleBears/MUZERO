import { describe, expect, it, vi } from "vitest";
import { createLrclibProvider } from "./lrclib-provider";
import { LyricsError, type LyricsQuery } from "./provider";

const QUERY: LyricsQuery = { trackName: "t", artistName: "a", durationSec: 200 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const GET_HIT = {
  id: 1,
  trackName: "t",
  artistName: "a",
  duration: 200,
  instrumental: false,
  plainLyrics: "p",
  syncedLyrics: "[00:01.00]x",
};

describe("createLrclibProvider.fetch", () => {
  it("returns the exact /api/get match without calling search", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(GET_HIT),
    );
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const hit = await provider.fetch(QUERY);

    expect(hit?.sourceId).toBe("1");
    expect(hit?.synced).toBe("[00:01.00]x");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/get?");
  });

  it("falls back to /api/search when /api/get returns 404", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/get")) return jsonResponse({}, 404);
      return jsonResponse([
        { ...GET_HIT, id: 9, duration: 260 },
        { ...GET_HIT, id: 7, duration: 201 },
      ]);
    });
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const hit = await provider.fetch(QUERY);

    // closest duration to 200 wins
    expect(hit?.sourceId).toBe("7");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("attaches match info (confidence + via) to an exact hit", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(GET_HIT));
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const hit = await provider.fetch(QUERY);
    expect(hit?.match?.via).toBe("exact");
    expect(hit?.match?.confidence).toBeGreaterThan(0.8);
  });

  it("recovers via the normalized + primary-artist rung when the exact signature 404s", async () => {
    // Title has a version suffix and the artist is a collab; the exact /api/get
    // (raw title + full artist) misses, but L1 (normalized title + primary artist) hits.
    const q: LyricsQuery = {
      trackName: "Song (Live)",
      artistName: "A, B",
      durationSec: 200,
    };
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/get")) {
        const clean =
          url.searchParams.get("track_name") === "Song" &&
          url.searchParams.get("artist_name") === "A";
        return clean
          ? jsonResponse({ ...GET_HIT, trackName: "Song", artistName: "A", duration: 200 })
          : jsonResponse({}, 404);
      }
      return jsonResponse([]);
    });
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const hit = await provider.fetch(q);
    expect(hit?.match?.via).toBe("norm");
    expect(hit?.synced).toBe("[00:01.00]x");
  });

  it("rejects a far-duration search candidate rather than caching a wrong version", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      if (String(input).includes("/api/get")) return jsonResponse({}, 404);
      // The only search hit is 40s off — must be rejected at every rung → null.
      return jsonResponse([{ ...GET_HIT, id: 5, duration: 240 }]);
    });
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await provider.fetch(QUERY)).toBeNull();
  });

  it("returns null when get 404s and search is empty", async () => {
    const fetchImpl = vi.fn(async (input: unknown) =>
      String(input).includes("/api/get") ? jsonResponse({}, 404) : jsonResponse([]),
    );
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(await provider.fetch(QUERY)).toBeNull();
  });

  it("throws a LyricsError on a 500 from /api/get", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 500));
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await expect(provider.fetch(QUERY)).rejects.toBeInstanceOf(LyricsError);
  });

  it("propagates the caller's abort through the combined timeout signal", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(GET_HIT),
    );
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const controller = new AbortController();

    await provider.fetch(QUERY, controller.signal);

    const passed = (fetchImpl.mock.calls[0][1] as RequestInit | undefined)?.signal;
    expect(passed).toBeInstanceOf(AbortSignal);
    expect(passed?.aborted).toBe(false);
    controller.abort();
    expect(passed?.aborted).toBe(true); // aborting the caller aborts the request
  });

  it("aborts a request that exceeds the timeout", async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, requestInit?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestInit?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const provider = createLrclibProvider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });

    await expect(provider.fetch(QUERY)).rejects.toBeTruthy();
  });
});

describe("createLrclibProvider.search", () => {
  it("returns all candidates from /api/search", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse([GET_HIT, { ...GET_HIT, id: 2 }]),
    );
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const hits = await provider.search?.(QUERY);
    expect(hits?.map((h) => h.sourceId)).toEqual(["1", "2"]);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/search?");
  });

  it("returns [] on 404", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await provider.search?.(QUERY)).toEqual([]);
  });
});

describe("createLrclibProvider.getById", () => {
  it("fetches a single record by id", async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(GET_HIT),
    );
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const hit = await provider.getById?.("1");
    expect(hit?.sourceId).toBe("1");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/api/get/1");
  });

  it("returns null on 404", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));
    const provider = createLrclibProvider({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await provider.getById?.("nope")).toBeNull();
  });
});

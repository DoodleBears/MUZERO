import { describe, expect, it } from "vitest";
import { createLastfmProvider } from "./lastfm-provider";
import { EnrichmentError, type EnrichmentQuery } from "./provider";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}
function fetchReturning(body: unknown, status = 200): typeof globalThis.fetch {
  return (async () => jsonResponse(body, status)) as unknown as typeof globalThis.fetch;
}

const Q: EnrichmentQuery = { trackName: "Yellow", artistName: "Coldplay" };
const provider = (fetchImpl: typeof globalThis.fetch, apiKey = "KEY") =>
  createLastfmProvider({ apiKey, fetchImpl });

describe("createLastfmProvider", () => {
  it("returns a normalized hit from top tags", async () => {
    const hit = await provider(
      fetchReturning({
        toptags: {
          tag: [
            { name: "alternative rock", count: 100 },
            { name: "britpop", count: 60 },
          ],
        },
      }),
    ).fetch(Q);
    expect(hit?.source).toBe("lastfm");
    expect(hit?.genres).toEqual(["alternative rock", "britpop"]);
  });

  it("returns null when Last.fm has no match (error 6)", async () => {
    const hit = await provider(fetchReturning({ error: 6, message: "Track not found" })).fetch(Q);
    expect(hit).toBeNull();
  });

  it("throws on an auth/param error (invalid key) so it isn't cached as a miss", async () => {
    await expect(
      provider(fetchReturning({ error: 10, message: "Invalid API key" })).fetch(Q),
    ).rejects.toBeInstanceOf(EnrichmentError);
  });

  it("throws on a non-2xx HTTP status", async () => {
    await expect(provider(fetchReturning({}, 500)).fetch(Q)).rejects.toBeInstanceOf(
      EnrichmentError,
    );
  });

  it("returns null when all tags normalize away", async () => {
    const hit = await provider(
      fetchReturning({ toptags: { tag: [{ name: "seen live", count: 90 }] } }),
    ).fetch(Q);
    expect(hit).toBeNull();
  });
});

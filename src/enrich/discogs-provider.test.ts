import { describe, expect, it } from "vitest";
import { createDiscogsProvider } from "./discogs-provider";
import { EnrichmentError, type EnrichmentQuery } from "./provider";

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}
const fetchReturning = (body: unknown, status = 200): typeof globalThis.fetch =>
  (async () => jsonResponse(body, status)) as unknown as typeof globalThis.fetch;

const Q: EnrichmentQuery = { trackName: "Yellow", artistName: "Coldplay" };
const provider = (fetchImpl: typeof globalThis.fetch) =>
  createDiscogsProvider({ token: "TOK", fetchImpl });

describe("createDiscogsProvider", () => {
  it("returns a hit with genres + styles from the top release", async () => {
    const hit = await provider(
      fetchReturning({
        results: [{ id: 1, genre: ["Rock"], style: ["Britpop", "Alternative Rock"] }],
      }),
    ).fetch(Q);
    expect(hit?.source).toBe("discogs");
    expect(hit?.genres).toEqual(["rock"]);
    expect(hit?.styles).toEqual(["britpop", "alternative rock"]);
  });

  it("returns null when the release has no genre/style", async () => {
    expect(await provider(fetchReturning({ results: [{ id: 1 }] })).fetch(Q)).toBeNull();
  });

  it("returns null when there are no results", async () => {
    expect(await provider(fetchReturning({ results: [] })).fetch(Q)).toBeNull();
  });

  it("throws on a non-2xx status", async () => {
    await expect(provider(fetchReturning({}, 401)).fetch(Q)).rejects.toBeInstanceOf(
      EnrichmentError,
    );
  });
});

import { describe, expect, it } from "vitest";
import { createMusicbrainzProvider } from "./musicbrainz-provider";
import type { EnrichmentQuery } from "./provider";

/** Minimal Response stub — the provider only reads `.ok` / `.status` / `.json()`. */
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
const notFound = { ok: false, status: 404, json: async () => null } as unknown as Response;

/** Route by the distinct URL fragment of each MusicBrainz endpoint. */
function mockFetch(routes: {
  recordingSearch?: unknown;
  recordingLookup?: unknown;
  artistSearch?: unknown;
  artistLookup?: unknown;
}): typeof globalThis.fetch {
  return (async (input: string | URL) => {
    const url = String(input);
    if (url.includes("/recording?query=") && routes.recordingSearch !== undefined)
      return jsonResponse(routes.recordingSearch);
    if (url.includes("/recording/") && routes.recordingLookup !== undefined)
      return jsonResponse(routes.recordingLookup);
    if (url.includes("/artist?query=") && routes.artistSearch !== undefined)
      return jsonResponse(routes.artistSearch);
    if (url.includes("/artist/") && routes.artistLookup !== undefined)
      return jsonResponse(routes.artistLookup);
    return notFound;
  }) as unknown as typeof globalThis.fetch;
}

const Q: EnrichmentQuery = { trackName: "稻香", artistName: "周杰伦" };

function provider(routes: Parameters<typeof mockFetch>[0]) {
  return createMusicbrainzProvider({
    fetchImpl: mockFetch(routes),
    intervalMs: 0,
    sleep: async () => {},
  });
}

describe("createMusicbrainzProvider — recording→artist ladder", () => {
  it("returns per-track recording genres when present (via recording)", async () => {
    const hit = await provider({
      recordingSearch: {
        recordings: [{ id: "rec1", score: 100, "artist-credit": [{ artist: { id: "art1" } }] }],
      },
      recordingLookup: {
        genres: [
          { name: "synth-pop", count: 2 },
          { name: "pop", count: 1 },
        ],
      },
    }).fetch(Q);
    expect(hit).not.toBeNull();
    expect(hit?.source).toBe("musicbrainz");
    expect(hit?.match?.via).toBe("recording");
    expect(hit?.genres).toEqual(["synth-pop", "pop"]);
    expect(hit?.sourceId).toBe("rec1");
  });

  it("falls back to dense artist genres when the recording is bare (via artist)", async () => {
    const hit = await provider({
      recordingSearch: {
        recordings: [{ id: "rec1", score: 100, "artist-credit": [{ artist: { id: "art1" } }] }],
      },
      recordingLookup: { genres: [], tags: [] },
      artistLookup: {
        genres: [
          { name: "mandopop", count: 4 },
          { name: "pop", count: 4 },
          { name: "zhongguo feng", count: 1 },
        ],
      },
    }).fetch(Q);
    expect(hit?.match?.via).toBe("artist");
    expect(hit?.genres).toEqual(["mandopop", "pop", "中国风"]);
    expect(hit?.sourceId).toBe("art1");
    // Artist-level is coarser → lower confidence than a per-track match.
    expect(hit?.match?.confidence).toBeLessThan(1);
  });

  it("resolves the artist by name when the recording search misses entirely", async () => {
    const hit = await provider({
      recordingSearch: { recordings: [] },
      artistSearch: { artists: [{ id: "art9" }] },
      artistLookup: { genres: [{ name: "j-pop", count: 7 }] },
    }).fetch(Q);
    expect(hit?.match?.via).toBe("artist");
    expect(hit?.genres).toEqual(["j-pop"]);
    expect(hit?.sourceId).toBe("art9");
  });

  it("returns null when neither the recording nor the artist has genres", async () => {
    const hit = await provider({
      recordingSearch: { recordings: [] },
      artistSearch: { artists: [] },
    }).fetch(Q);
    expect(hit).toBeNull();
  });

  it("ignores a low-score recording match (below the gate) but still tries the artist", async () => {
    const hit = await provider({
      recordingSearch: { recordings: [{ id: "recX", score: 40 }] },
      artistSearch: { artists: [{ id: "artX" }] },
      artistLookup: { genres: [{ name: "rock", count: 3 }] },
    }).fetch(Q);
    expect(hit?.match?.via).toBe("artist");
    expect(hit?.sourceId).toBe("artX");
  });

  it("uses an ID3 recording MBID directly, skipping the search", async () => {
    const hit = await provider({
      recordingLookup: { genres: [{ name: "ambient", count: 1 }] },
    }).fetch({ ...Q, musicBrainzRecordingId: "mbid-known" });
    expect(hit?.match?.via).toBe("recording");
    expect(hit?.sourceId).toBe("mbid-known");
    expect(hit?.genres).toEqual(["ambient"]);
  });

  it("returns null once the caller aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const hit = await provider({
      recordingSearch: { recordings: [{ id: "rec1", score: 100 }] },
      recordingLookup: { genres: [{ name: "pop", count: 1 }] },
    }).fetch(Q, controller.signal);
    expect(hit).toBeNull();
  });
});

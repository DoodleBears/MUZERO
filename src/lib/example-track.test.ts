import { describe, expect, it, vi } from "vitest";
import {
  EXAMPLE_TRACK_AUDIO_FILE_NAME,
  EXAMPLE_TRACK_COVER_FILE_NAME,
  loadExampleTrackAssets,
} from "./example-track";

// `loadExampleTrackAssets` takes its fetch as a parameter, so it is tested with an
// EXPLICITLY injected stub — no global `fetch` patching, no network, no timing. The
// import-orchestration side (player-store) mocks this loader wholesale instead.
describe("loadExampleTrackAssets", () => {
  function fetchStub() {
    return vi.fn(async (input: RequestInfo | URL) => {
      const isCover = String(input).endsWith(".jpg");
      return new Response(new Uint8Array(isCover ? [9, 8, 7] : [1, 2, 3]), {
        headers: { "content-type": isCover ? "image/jpeg" : "audio/mpeg" },
      });
    });
  }

  it("fetches the bundled audio + cover from the BASE_URL examples path", async () => {
    const fetchAsset = fetchStub();

    const { audio, cover } = await loadExampleTrackAssets(fetchAsset);

    const urls = fetchAsset.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith(`examples/${EXAMPLE_TRACK_AUDIO_FILE_NAME}`))).toBe(true);
    expect(urls.some((u) => u.endsWith(`examples/${EXAMPLE_TRACK_COVER_FILE_NAME}`))).toBe(true);

    expect(audio).toBeInstanceOf(File);
    expect(audio.name).toBe(EXAMPLE_TRACK_AUDIO_FILE_NAME);
    expect(audio.type).toBe("audio/mpeg");
    expect(audio.size).toBe(3);

    expect(cover.mime).toBe("image/jpeg");
    expect(cover.blob.size).toBe(3);
  });

  it("falls back to the declared mime when the response carries no content-type", async () => {
    const fetchAsset = vi.fn(async (input: RequestInfo | URL) => {
      const isCover = String(input).endsWith(".jpg");
      // No content-type header → blob.type is "" → the loader applies the fallback.
      return new Response(new Uint8Array(isCover ? [9, 8, 7] : [1, 2, 3]));
    });

    const { audio, cover } = await loadExampleTrackAssets(fetchAsset);

    expect(audio.type).toBe("audio/mpeg");
    expect(cover.mime).toBe("image/jpeg");
  });

  it("throws when an asset cannot be loaded", async () => {
    const fetchAsset = vi.fn(async () => new Response("nope", { status: 404 }));

    await expect(loadExampleTrackAssets(fetchAsset)).rejects.toThrow(
      /Failed to load bundled example asset/,
    );
  });
});

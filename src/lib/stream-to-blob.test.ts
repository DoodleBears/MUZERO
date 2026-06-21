import { describe, expect, it, vi } from "vitest";
import { streamResponseToBlob } from "./stream-to-blob";

function streamingResponse(chunks: Uint8Array[], headers: Record<string, string>): Response {
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
  return new Response(body, { headers });
}

describe("streamResponseToBlob", () => {
  it("reports cumulative byte progress and returns the full blob", async () => {
    const chunks = [new Uint8Array(3), new Uint8Array(2), new Uint8Array(5)];
    const resp = streamingResponse(chunks, {
      "content-type": "audio/mpeg",
      "content-length": "10",
    });
    const onProgress = vi.fn();

    const blob = await streamResponseToBlob(resp, onProgress);

    expect(blob.size).toBe(10);
    expect(blob.type).toBe("audio/mpeg");
    expect(onProgress.mock.calls).toEqual([
      [3, 10],
      [5, 10],
      [10, 10],
    ]);
  });

  it("falls back to the x-muzero-content-length header for the total", async () => {
    const resp = streamingResponse([new Uint8Array(4)], {
      "x-muzero-content-length": "4",
    });
    const onProgress = vi.fn();

    await streamResponseToBlob(resp, onProgress);

    expect(onProgress).toHaveBeenLastCalledWith(4, 4);
  });

  it("skips streaming (one-shot blob) when no total is known", async () => {
    const resp = streamingResponse([new Uint8Array(4)], { "content-type": "audio/mpeg" });
    const blobSpy = vi.spyOn(resp, "blob");
    const onProgress = vi.fn();

    const blob = await streamResponseToBlob(resp, onProgress);

    expect(blob.size).toBe(4);
    expect(onProgress).not.toHaveBeenCalled();
    expect(blobSpy).toHaveBeenCalledTimes(1);
  });

  it("skips streaming when no onProgress callback is provided", async () => {
    const resp = streamingResponse([new Uint8Array(6)], { "content-length": "6" });
    const blobSpy = vi.spyOn(resp, "blob");

    const blob = await streamResponseToBlob(resp);

    expect(blob.size).toBe(6);
    expect(blobSpy).toHaveBeenCalledTimes(1);
  });
});

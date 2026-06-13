import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoverMetadataClient } from "./cover-client";
import type { CoverMetadataResult } from "./cover-derivative-core";

function pngBlob() {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
}

describe("cover metadata worker client", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to inline extraction when Worker is unavailable", async () => {
    const inlineExtract = vi.fn(
      async (): Promise<CoverMetadataResult> => ({
        palette: [{ r: 10, g: 20, b: 30 }],
        timings: { decodeMs: 0, paletteMs: 0, thumbnailMs: 0, thumbhashMs: 0, totalMs: 1 },
      }),
    );
    const client = createCoverMetadataClient({
      inlineExtract,
      workerFactory: () => null,
    });

    await expect(
      client.extract({
        blob: pngBlob(),
        mime: "image/png",
        sourceKey: "blb_fallback",
        targets: ["palette"],
      }),
    ).resolves.toMatchObject({
      palette: [{ r: 10, g: 20, b: 30 }],
    });
    expect(inlineExtract).toHaveBeenCalledTimes(1);
  });

  it("normalizes worker palette channels and blank thumbhashes", async () => {
    const fakeWorker = makeFakeWorker((message, worker) => {
      worker.onmessage?.({
        data: {
          reqId: message.reqId,
          result: {
            palette: [
              { r: 1.2, g: 999, b: -2 },
              { r: 1, g: 255, b: 0 },
            ],
            thumbhash: "   ",
            timings: { decodeMs: 3, paletteMs: 4, thumbnailMs: 0, thumbhashMs: 5, totalMs: 12 },
          },
          type: "cover-metadata-result",
        },
      } as MessageEvent);
    });
    const client = createCoverMetadataClient({
      inlineExtract: vi.fn(),
      workerFactory: () => fakeWorker as unknown as Worker,
    });

    await expect(
      client.extract({
        blob: pngBlob(),
        mime: "image/png",
        sourceKey: "blb_worker",
      }),
    ).resolves.toEqual({
      palette: [{ r: 1, g: 255, b: 0 }],
      thumbhash: undefined,
      timings: { decodeMs: 3, paletteMs: 4, thumbnailMs: 0, thumbhashMs: 5, totalMs: 12 },
    });
  });

  it("dedupes concurrent requests with the same source key and targets", async () => {
    let release:
      | ((result: {
          palette: { r: number; g: number; b: number }[];
          timings: CoverMetadataResult["timings"];
        }) => void)
      | undefined;
    const fakeWorker = makeFakeWorker((message, worker) => {
      release = (result) => {
        worker.onmessage?.({
          data: {
            reqId: message.reqId,
            result,
            type: "cover-metadata-result",
          },
        } as MessageEvent);
      };
    });
    const client = createCoverMetadataClient({
      inlineExtract: vi.fn(),
      workerFactory: () => fakeWorker as unknown as Worker,
    });
    const input = {
      blob: pngBlob(),
      mime: "image/png",
      sourceKey: "blb_same",
      targets: ["palette" as const],
    };

    const first = client.extract(input);
    const second = client.extract(input);

    await waitFor(() => expect(fakeWorker.postMessage).toHaveBeenCalledTimes(1));
    release?.({
      palette: [{ r: 20, g: 30, b: 40 }],
      timings: { decodeMs: 1, paletteMs: 2, thumbnailMs: 0, thumbhashMs: 0, totalMs: 3 },
    });
    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        palette: [{ r: 20, g: 30, b: 40 }],
        thumbhash: undefined,
        timings: { decodeMs: 1, paletteMs: 2, thumbnailMs: 0, thumbhashMs: 0, totalMs: 3 },
      },
      {
        palette: [{ r: 20, g: 30, b: 40 }],
        thumbhash: undefined,
        timings: { decodeMs: 1, paletteMs: 2, thumbnailMs: 0, thumbhashMs: 0, totalMs: 3 },
      },
    ]);
  });
});

function makeFakeWorker(
  onPost: (
    message: { reqId: number; [key: string]: unknown },
    worker: { onmessage?: ((event: MessageEvent) => void) | null },
  ) => void,
) {
  const fakeWorker = {
    onerror: null as ((event: ErrorEvent) => void) | null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage: vi.fn((message: { reqId: number; [key: string]: unknown }) => {
      onPost(message, fakeWorker);
    }),
    terminate: vi.fn(),
  };
  return fakeWorker;
}

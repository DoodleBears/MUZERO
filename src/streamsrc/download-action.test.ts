import { describe, expect, it, vi } from "vitest";
import { enqueuePartsForDownload } from "./download-action";
import type { EnqueueInput } from "./download-queue";
import type { StreamPart, StreamSearchHit } from "./provider";

function hit(): StreamSearchHit {
  return {
    source: "bili",
    externalId: "BV1",
    title: "Whole video",
    coverUrl: "https://cdn/cover.jpg",
  };
}

function part(index: number): StreamPart {
  return { externalId: `BV1#cid${index}`, index, title: `P${index}`, durationSec: 60 };
}

describe("enqueuePartsForDownload", () => {
  it("enqueues every part through the persistent queue and returns the count", async () => {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);

    const count = await enqueuePartsForDownload(hit(), [part(1), part(2), part(3)], enqueue);

    expect(count).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      source: "bili",
      externalId: "BV1#cid1",
      title: "P1",
      coverUrl: "https://cdn/cover.jpg",
    });
    expect(enqueue).toHaveBeenNthCalledWith(3, {
      source: "bili",
      externalId: "BV1#cid3",
      title: "P3",
      coverUrl: "https://cdn/cover.jpg",
    });
  });

  it("enqueues nothing for an empty part list", async () => {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);

    const count = await enqueuePartsForDownload(hit(), [], enqueue);

    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

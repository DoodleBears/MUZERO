import { describe, expect, it, vi } from "vitest";
import {
  composePartTitle,
  enqueueHitsForDownload,
  enqueuePartsForDownload,
} from "./download-action";
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

function favHit(n: number): StreamSearchHit {
  return {
    source: "bili",
    externalId: `BV${n}`,
    title: `Fav ${n}`,
    coverUrl: `https://cdn/${n}.jpg`,
  };
}

function part(index: number): StreamPart {
  return { externalId: `BV1#cid${index}`, index, title: `P${index}`, durationSec: 60 };
}

describe("enqueuePartsForDownload", () => {
  it("composes stable part titles without losing the video title", () => {
    expect(composePartTitle("Whole video", "P1", 3)).toBe("Whole video - P1");
    expect(composePartTitle("Whole video", "Whole video", 3)).toBe("Whole video");
    expect(composePartTitle("Whole video", "P1", 1)).toBe("Whole video");
  });

  it("enqueues every part through the persistent queue and returns the count", async () => {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);

    const count = await enqueuePartsForDownload(hit(), [part(1), part(2), part(3)], enqueue);

    expect(count).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      source: "bili",
      externalId: "BV1#cid1",
      title: "Whole video - P1",
      coverUrl: "https://cdn/cover.jpg",
    });
    expect(enqueue).toHaveBeenNthCalledWith(3, {
      source: "bili",
      externalId: "BV1#cid3",
      title: "Whole video - P3",
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

describe("enqueueHitsForDownload (favlist re-sync → video queue)", () => {
  it("enqueues every hit targeting the set, so progress shows in the download indicator", async () => {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);

    const count = await enqueueHitsForDownload(
      [favHit(1), favHit(2)],
      { sessionId: "ses_fav", quality: "1080" },
      enqueue,
    );

    expect(count).toBe(2);
    expect(enqueue).toHaveBeenCalledTimes(2);
    // The crucial bit the old in-memory cache path missed: a queued job bound to the set
    // (→ db.downloadJobs → indicator) at the chosen quality.
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      source: "bili",
      externalId: "BV1",
      title: "Fav 1",
      coverUrl: "https://cdn/1.jpg",
      sessionId: "ses_fav",
      quality: "1080",
    });
    expect(enqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({ externalId: "BV2" }));
  });

  it("enqueues nothing for an empty hit list", async () => {
    const enqueue = vi.fn(async (_input: EnqueueInput) => undefined);

    const count = await enqueueHitsForDownload([], { sessionId: "ses_fav" }, enqueue);

    expect(count).toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { DownloadJob } from "@/db/types";
import {
  composePartTitle,
  enqueueDownloadAndWait,
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

describe("enqueueDownloadAndWait", () => {
  it("waits for the persistent queued job to finish and returns the track id", async () => {
    const job = jobRow({ status: "pending" });
    const states: DownloadJob[] = [
      job,
      { ...job, status: "active" },
      { ...job, status: "done", trackId: "trk_done" },
    ];

    const result = await enqueueDownloadAndWait(
      { source: "bili", externalId: "BV1#1", title: "MV", quality: "1080" },
      {
        enqueue: async () => job,
        listJobs: async () => [states.shift() ?? states[states.length - 1] ?? job],
        sleep: async () => undefined,
        timeoutMs: 1000,
      },
    );

    expect(result).toMatchObject({ kind: "downloaded", trackId: "trk_done" });
  });

  it("turns a failed queued job into a download error", async () => {
    const job = jobRow({ status: "failed", lastError: "login" });

    await expect(
      enqueueDownloadAndWait(
        { source: "bili", externalId: "BV1#1", title: "MV" },
        {
          enqueue: async () => job,
          listJobs: async () => [job],
          sleep: async () => undefined,
          timeoutMs: 1000,
        },
      ),
    ).resolves.toEqual({ kind: "error", message: "login" });
  });
});

function jobRow(patch: Partial<DownloadJob>): DownloadJob {
  return {
    attempts: 0,
    bytesDone: 0,
    createdAt: 1,
    externalId: "BV1#1",
    id: "dlj_1",
    source: "bili",
    status: "pending",
    title: "MV",
    updatedAt: 1,
    ...patch,
  };
}

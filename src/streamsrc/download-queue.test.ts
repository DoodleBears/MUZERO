import { describe, expect, it } from "vitest";
import type { DownloadJob } from "@/db/types";
import {
  canRetry,
  createDownloadJob,
  jobsToRecover,
  MAX_DOWNLOAD_ATTEMPTS,
  retryBackoffMs,
  sameTarget,
  selectNextJobs,
} from "./download-queue";

function job(over: Partial<DownloadJob>): DownloadJob {
  return {
    id: "j",
    source: "bili",
    externalId: "BV1",
    title: "t",
    status: "pending",
    bytesDone: 0,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("createDownloadJob", () => {
  it("builds a fresh pending job with injected id/now", () => {
    const j = createDownloadJob(
      { source: "bili", externalId: "BV9", title: "Hi", quality: "1080", sessionId: "ses_1" },
      "job_1",
      1234,
    );
    expect(j).toMatchObject({
      id: "job_1",
      source: "bili",
      externalId: "BV9",
      title: "Hi",
      quality: "1080",
      sessionId: "ses_1",
      status: "pending",
      bytesDone: 0,
      attempts: 0,
      createdAt: 1234,
      updatedAt: 1234,
    });
  });
});

describe("sameTarget (dedupe key)", () => {
  it("matches on source + externalId + quality + audioOnly", () => {
    const a = job({ quality: "1080" });
    expect(sameTarget(a, job({ quality: "1080" }))).toBe(true);
    expect(sameTarget(a, job({ quality: "720" }))).toBe(false);
    expect(sameTarget(a, job({ externalId: "BV2", quality: "1080" }))).toBe(false);
    expect(sameTarget(a, job({ source: "youtube", quality: "1080" }))).toBe(false);
    expect(sameTarget(job({ audioOnly: true }), job({ audioOnly: false }))).toBe(false);
    // missing quality vs undefined are equal
    expect(sameTarget(job({ quality: undefined }), job({}))).toBe(true);
  });
});

describe("selectNextJobs", () => {
  const jobs: DownloadJob[] = [
    job({ id: "a", status: "active", createdAt: 1 }),
    job({ id: "p1", status: "pending", createdAt: 2 }),
    job({ id: "p2", status: "pending", createdAt: 3 }),
    job({ id: "done", status: "done", createdAt: 4 }),
    job({ id: "paused", status: "paused", createdAt: 5 }),
  ];

  it("returns pending jobs up to (concurrency - active), FIFO by createdAt", () => {
    expect(selectNextJobs(jobs, 2).map((j) => j.id)).toEqual(["p1"]); // 1 active, 1 slot
    expect(selectNextJobs(jobs, 3).map((j) => j.id)).toEqual(["p1", "p2"]); // 2 slots
    expect(selectNextJobs(jobs, 1).map((j) => j.id)).toEqual([]); // active already fills it
  });

  it("never returns done/failed/paused", () => {
    const picked = selectNextJobs(jobs, 10);
    expect(picked.every((j) => j.status === "pending")).toBe(true);
  });
});

describe("jobsToRecover", () => {
  it("returns jobs left active from a previous run (to reset to pending)", () => {
    const recovered = jobsToRecover([
      job({ id: "a", status: "active" }),
      job({ id: "p", status: "pending" }),
      job({ id: "d", status: "done" }),
    ]);
    expect(recovered.map((j) => j.id)).toEqual(["a"]);
  });
});

describe("canRetry + retryBackoffMs", () => {
  it("retries until MAX_DOWNLOAD_ATTEMPTS", () => {
    expect(canRetry(job({ attempts: 0 }))).toBe(true);
    expect(canRetry(job({ attempts: MAX_DOWNLOAD_ATTEMPTS - 1 }))).toBe(true);
    expect(canRetry(job({ attempts: MAX_DOWNLOAD_ATTEMPTS }))).toBe(false);
  });

  it("backoff grows with attempts and is capped + monotonic", () => {
    const b1 = retryBackoffMs(1);
    const b2 = retryBackoffMs(2);
    const b3 = retryBackoffMs(3);
    expect(b2).toBeGreaterThan(b1);
    expect(b3).toBeGreaterThan(b2);
    expect(retryBackoffMs(99)).toBeLessThanOrEqual(retryBackoffMs(100));
    expect(retryBackoffMs(100)).toBeLessThanOrEqual(10 * 60_000); // capped
  });
});

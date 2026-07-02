import { describe, expect, it } from "vitest";
import type { DownloadJob } from "@/db/types";
import {
  downloadAggregateProgress,
  filterDownloadJobs,
  orderDownloadJobs,
  summarizeDownloadCenter,
} from "./download-center";

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

describe("filterDownloadJobs", () => {
  const jobs: DownloadJob[] = [
    job({ id: "a", status: "active" }),
    job({ id: "p", status: "pending" }),
    job({ id: "pa", status: "paused" }),
    job({ id: "d", status: "done" }),
    job({ id: "f", status: "failed" }),
  ];

  it("all → every job, order preserved", () => {
    expect(filterDownloadJobs(jobs, "all").map((j) => j.id)).toEqual(["a", "p", "pa", "d", "f"]);
  });

  it("active → in-flight = active + pending + paused", () => {
    expect(filterDownloadJobs(jobs, "active").map((j) => j.id)).toEqual(["a", "p", "pa"]);
  });

  it("done → only done", () => {
    expect(filterDownloadJobs(jobs, "done").map((j) => j.id)).toEqual(["d"]);
  });

  it("failed → only failed", () => {
    expect(filterDownloadJobs(jobs, "failed").map((j) => j.id)).toEqual(["f"]);
  });

  it("does not mutate the input", () => {
    const input: DownloadJob[] = [job({ id: "x", status: "active" })];
    filterDownloadJobs(input, "all");
    expect(input).toHaveLength(1);
  });
});

describe("orderDownloadJobs", () => {
  it("orders active → pending → paused → failed → done", () => {
    const jobs: DownloadJob[] = [
      job({ id: "done", status: "done" }),
      job({ id: "failed", status: "failed" }),
      job({ id: "paused", status: "paused" }),
      job({ id: "pending", status: "pending" }),
      job({ id: "active", status: "active" }),
    ];
    expect(orderDownloadJobs(jobs).map((j) => j.id)).toEqual([
      "active",
      "pending",
      "paused",
      "failed",
      "done",
    ]);
  });

  it("within a status group, newest updatedAt first", () => {
    const jobs: DownloadJob[] = [
      job({ id: "old", status: "active", updatedAt: 100 }),
      job({ id: "new", status: "active", updatedAt: 300 }),
      job({ id: "mid", status: "active", updatedAt: 200 }),
    ];
    expect(orderDownloadJobs(jobs).map((j) => j.id)).toEqual(["new", "mid", "old"]);
  });

  it("does not mutate the input array", () => {
    const jobs: DownloadJob[] = [
      job({ id: "d", status: "done" }),
      job({ id: "a", status: "active" }),
    ];
    orderDownloadJobs(jobs);
    expect(jobs.map((j) => j.id)).toEqual(["d", "a"]);
  });
});

describe("downloadAggregateProgress", () => {
  it("averages bytesDone/totalBytes over active jobs with a known total", () => {
    const jobs: DownloadJob[] = [
      job({ status: "active", bytesDone: 50, totalBytes: 100 }), // .5
      job({ status: "active", bytesDone: 25, totalBytes: 100 }), // .25
    ];
    expect(downloadAggregateProgress(jobs)).toBeCloseTo(0.375);
  });

  it("ignores non-active jobs and active jobs without a total", () => {
    const jobs: DownloadJob[] = [
      job({ status: "active", bytesDone: 40, totalBytes: 100 }), // .4
      job({ status: "pending", bytesDone: 999, totalBytes: 100 }), // not active → ignored
      job({ status: "active", bytesDone: 10 }), // no total → ignored
    ];
    expect(downloadAggregateProgress(jobs)).toBeCloseTo(0.4);
  });

  it("returns null when nothing is measurable", () => {
    expect(downloadAggregateProgress([job({ status: "active" })])).toBeNull();
    expect(downloadAggregateProgress([])).toBeNull();
  });
});

describe("summarizeDownloadCenter", () => {
  it("counts by bucket (in-flight = active + pending + paused) + shares the progress口径", () => {
    const s = summarizeDownloadCenter([
      job({ status: "active", bytesDone: 50, totalBytes: 100 }),
      job({ status: "pending" }),
      job({ status: "paused" }),
      job({ status: "done" }),
      job({ status: "failed" }),
      job({ status: "failed" }),
    ]);
    expect(s).toMatchObject({ total: 6, inFlight: 3, done: 1, failed: 2 });
    expect(s.progress).toBeCloseTo(0.5);
  });

  it("empty queue → zeros + null progress", () => {
    expect(summarizeDownloadCenter([])).toEqual({
      total: 0,
      inFlight: 0,
      done: 0,
      failed: 0,
      progress: null,
    });
  });

  it("all done → inFlight 0 + null progress", () => {
    const s = summarizeDownloadCenter([job({ status: "done" }), job({ status: "done" })]);
    expect(s).toMatchObject({ total: 2, inFlight: 0, done: 2, failed: 0, progress: null });
  });
});

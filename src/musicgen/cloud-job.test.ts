import { describe, expect, it } from "vitest";
import type { TrackBrief } from "@/dj/dj-brief-schema";
import { JobFailedError, type JobStatus, JobTimeoutError, pollUntilComplete } from "./cloud-job";
import { mapBriefToBody, parseCreate, parseStatus } from "./cloud-provider";

/** A controllable virtual clock so the polling loop is deterministic. */
function virtualClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("pollUntilComplete", () => {
  it("resolves once the job reports succeeded", async () => {
    const states: JobStatus[] = [
      { state: "pending", progress: 0.2 },
      { state: "pending", progress: 0.6 },
      { state: "succeeded", audioUrl: "https://cdn/audio.mp3" },
    ];
    let i = 0;
    const clock = virtualClock();
    const progress: number[] = [];
    const result = await pollUntilComplete(async () => states[i++], {
      intervalMs: 1000,
      timeoutMs: 60_000,
      onProgress: (p) => progress.push(p),
      ...clock,
    });
    expect(result.state).toBe("succeeded");
    expect(result.audioUrl).toBe("https://cdn/audio.mp3");
    expect(progress).toEqual([0.2, 0.6]);
  });

  it("throws JobFailedError when the job fails", async () => {
    const clock = virtualClock();
    await expect(
      pollUntilComplete(async () => ({ state: "failed", error: "bad prompt" }), {
        intervalMs: 1000,
        timeoutMs: 60_000,
        ...clock,
      }),
    ).rejects.toBeInstanceOf(JobFailedError);
  });

  it("throws JobTimeoutError when it never finishes", async () => {
    const clock = virtualClock();
    await expect(
      pollUntilComplete(async () => ({ state: "pending" }), {
        intervalMs: 1000,
        timeoutMs: 3000,
        ...clock,
      }),
    ).rejects.toBeInstanceOf(JobTimeoutError);
  });

  it("aborts when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      pollUntilComplete(async () => ({ state: "pending" }), {
        intervalMs: 1000,
        timeoutMs: 3000,
        signal: controller.signal,
        ...virtualClock(),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("cloud vendor mapping", () => {
  const brief: TrackBrief = {
    title: "Neon Rain",
    caption: "lofi hip hop",
    lyrics: "[verse]\nrain",
    durationSec: 45,
    bpm: 82,
    keyscale: "A minor",
  };

  it("maps a brief onto a generic request body", () => {
    const body = mapBriefToBody(brief, { baseUrl: "https://api.x", model: "music-1" });
    expect(body).toMatchObject({
      model: "music-1",
      prompt: "lofi hip hop",
      duration_seconds: 45,
      bpm: 82,
      key: "A minor",
      title: "Neon Rain",
    });
  });

  it("parseCreate finds a job id or a synchronous audio url", () => {
    expect(parseCreate({ id: "job_123" })).toEqual({ jobId: "job_123", audioUrl: undefined });
    expect(parseCreate({ audio_url: "https://cdn/a.mp3" })).toMatchObject({
      audioUrl: "https://cdn/a.mp3",
    });
  });

  it("parseStatus normalizes vendor status vocab", () => {
    expect(parseStatus({ status: "processing" }).state).toBe("pending");
    expect(parseStatus({ status: "completed", url: "https://cdn/a.mp3" })).toMatchObject({
      state: "succeeded",
      audioUrl: "https://cdn/a.mp3",
    });
    expect(parseStatus({ status: "error", message: "nope" })).toMatchObject({
      state: "failed",
      error: "nope",
    });
    // No explicit status but an audio url present ⇒ done.
    expect(parseStatus({ output: "https://cdn/a.mp3" }).state).toBe("succeeded");
  });
});

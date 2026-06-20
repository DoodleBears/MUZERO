import { beforeEach, describe, expect, it } from "vitest";
import type { DownloadJob } from "@/db/types";
import {
  createDownloadQueueRunner,
  type DownloadQueueRunner,
  type RunJobResult,
} from "./download-queue-runner";

/** Let queued microtasks + the fire-and-forget tick/startJob chains drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

let store: Map<string, DownloadJob>;
let resolvers: Map<string, (r: RunJobResult) => void>;
let retries: Array<() => void>;
let idN: number;
let runner: DownloadQueueRunner;

function makeRunner(concurrency = 2) {
  return createDownloadQueueRunner({
    now: () => 1000,
    newId: () => `job_${++idN}`,
    getConcurrency: () => concurrency,
    listJobs: async () => [...store.values()],
    putJob: async (j) => {
      store.set(j.id, j);
    },
    updateJob: async (id, patch) => {
      const j = store.get(id);
      if (j) store.set(id, { ...j, ...patch });
    },
    runJob: (job) =>
      new Promise<RunJobResult>((resolve) => {
        resolvers.set(job.id, resolve);
      }),
    scheduleRetry: (_ms, cb) => {
      retries.push(cb);
    },
  });
}

function byStatus(status: DownloadJob["status"]): DownloadJob[] {
  return [...store.values()].filter((j) => j.status === status);
}

beforeEach(() => {
  store = new Map();
  resolvers = new Map();
  retries = [];
  idN = 0;
  runner = makeRunner(2);
});

describe("download queue runner", () => {
  it("respects the concurrency cap and starts the next when a slot frees", async () => {
    await runner.enqueue({ source: "bili", externalId: "a", title: "A" });
    await runner.enqueue({ source: "bili", externalId: "b", title: "B" });
    await runner.enqueue({ source: "bili", externalId: "c", title: "C" });
    await flush();

    expect(byStatus("active")).toHaveLength(2);
    expect(byStatus("pending")).toHaveLength(1);

    const first = byStatus("active")[0];
    resolvers.get(first.id)?.({ ok: true, trackId: "trk_x", retriable: false });
    await flush();

    expect(store.get(first.id)?.status).toBe("done");
    expect(store.get(first.id)?.trackId).toBe("trk_x");
    expect(byStatus("active")).toHaveLength(2); // the formerly-pending one started
    expect(byStatus("pending")).toHaveLength(0);
  });

  it("dedupes an identical enqueue", async () => {
    await runner.enqueue({ source: "bili", externalId: "a", title: "A", quality: "1080" });
    await runner.enqueue({ source: "bili", externalId: "a", title: "A", quality: "1080" });
    await flush();
    expect(store.size).toBe(1);
  });

  it("recovers jobs left active after a restart (active → pending → restarted)", async () => {
    store.set("old", {
      id: "old",
      source: "bili",
      externalId: "z",
      title: "Z",
      status: "active", // left mid-flight by a previous run
      bytesDone: 50,
      attempts: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    await runner.recover();
    await flush();
    // recovered → re-driven → active again, and the runner is running it
    expect(store.get("old")?.status).toBe("active");
    expect(runner.isRunning("old")).toBe(true);
    expect(store.get("old")?.bytesDone).toBe(50); // resume offset preserved
  });

  it("retries a retriable failure with backoff, terminal-fails after the cap", async () => {
    await runner.enqueue({ source: "bili", externalId: "a", title: "A" });
    await flush();
    const id = byStatus("active")[0].id;

    // fail 4 times; first 3 schedule a retry, the 4th is terminal (MAX_DOWNLOAD_ATTEMPTS=4)
    for (let i = 1; i <= 4; i++) {
      resolvers.get(id)?.({ ok: false, retriable: true, error: "net" });
      await flush();
      expect(store.get(id)?.attempts).toBe(i);
      if (i < 4) {
        expect(retries).toHaveLength(i);
        retries[i - 1](); // trigger the scheduled retry → pending → active again
        await flush();
        expect(store.get(id)?.status).toBe("active");
      }
    }
    expect(store.get(id)?.status).toBe("failed");
    expect(retries).toHaveLength(3); // no retry scheduled after the 4th
  });

  it("marks non-retriable failures (login wall) failed without retry", async () => {
    await runner.enqueue({ source: "bili", externalId: "a", title: "A" });
    await flush();
    const id = byStatus("active")[0].id;
    resolvers.get(id)?.({ ok: false, retriable: false, error: "login" });
    await flush();
    expect(store.get(id)?.status).toBe("failed");
    expect(store.get(id)?.lastError).toBe("login");
    expect(retries).toHaveLength(0);
  });
});

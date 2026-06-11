import { describe, expect, it, vi } from "vitest";
import type { AppSettings, CloudDrive, R2LocalCredentials } from "@/db/types";
import type { R2ExportPlan, R2ExportPlanForDriveInput } from "./r2-export-plan";
import type { R2PublishProgressEvent } from "./r2-publish";
import { R2PublishHttpError } from "./r2-publish";
import type { RemoteSetConflict } from "./r2-pull-diff";
import type {
  ApplyRemoteSetPullInput,
  ApplyRemoteSetPullResult,
  RemoteSetPullPreview,
} from "./r2-pull-sync";
import type { RemoteSetIndexResult } from "./r2-subscription";
import {
  createSyncOrchestrator,
  type PublishDriveContext,
  type SyncProgress,
} from "./sync-orchestrator";

function makePlan(overrides: Partial<R2ExportPlan> = {}): R2ExportPlan {
  return {
    driveId: "drv_owned",
    libraryId: "lib_1",
    baseUrl: "https://music.example.com/muzero/",
    objects: [
      {
        kind: "media",
        key: "objects/media/a.mp3",
        contentType: "audio/mpeg",
        bytes: 100,
        body: "a",
      },
      {
        kind: "set-index",
        key: "sets/s/index.json",
        contentType: "application/json",
        bytes: 20,
        body: "{}",
      },
    ],
    totalBytes: 120,
    ...overrides,
  };
}

const credentials: R2LocalCredentials = {
  accountId: "acct",
  bucket: "bucket",
  accessKeyId: "key",
  secretAccessKey: "secret",
};

const ctx: PublishDriveContext = {
  drive: { id: "drv_owned" } as CloudDrive,
  settings: {} as AppSettings,
  credentials,
  libraryId: "lib_1",
  baseUrl: "https://music.example.com/muzero/",
  setIds: ["s"],
};

function progressEvent(over: Partial<R2PublishProgressEvent>): R2PublishProgressEvent {
  return {
    object: { kind: "media", key: "x", contentType: "audio/mpeg", bytes: 0, body: "" },
    status: "uploaded",
    uploaded: 0,
    skipped: 0,
    bytesDone: 0,
    bytesTotal: 120,
    ...over,
  };
}

describe("createSyncOrchestrator.publish", () => {
  it("plans then publishes, emitting planning -> uploading -> completed with progress", async () => {
    const events: SyncProgress[] = [];
    const buildPlan = vi.fn(async () => makePlan());
    const runPublish = vi.fn(async (_plan, _creds, options) => {
      options.onProgress?.(
        progressEvent({ object: makePlan().objects[0]!, uploaded: 1, bytesDone: 100 }),
      );
      options.onProgress?.(
        progressEvent({ object: makePlan().objects[1]!, uploaded: 2, bytesDone: 120 }),
      );
      return { runId: "run_1" };
    });
    const orchestrator = createSyncOrchestrator({ buildPlan, runPublish });

    const result = await orchestrator.publish(ctx, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({ status: "completed", runId: "run_1" });
    expect(buildPlan).toHaveBeenCalledWith(
      expect.objectContaining({ libraryId: "lib_1", setIds: ["s"], drive: ctx.drive }),
    );
    expect(events.map((e) => e.phase)).toEqual([
      "planning",
      "uploading",
      "uploading",
      "uploading",
      "completed",
    ]);
    const last = events.at(-1)!;
    expect(last).toMatchObject({
      driveId: "drv_owned",
      direction: "push",
      objectsDone: 2,
      objectsTotal: 2,
      bytesDone: 120,
      bytesTotal: 120,
      runId: "run_1",
    });
    const midUpload = events[2]!;
    expect(midUpload).toMatchObject({
      objectsDone: 1,
      bytesDone: 100,
      currentKey: "objects/media/a.mp3",
    });
  });

  it("does not publish when the plan has conflicts; reports needs-review", async () => {
    const events: SyncProgress[] = [];
    const conflicts = [
      {
        setId: "s",
        entityType: "set" as const,
        entityId: "s",
        reason: "overlapping-mutations" as const,
        mutationIds: ["m1", "m2"],
      },
    ];
    const buildPlan = vi.fn(async () => makePlan({ conflicts }));
    const runPublish = vi.fn();
    const orchestrator = createSyncOrchestrator({ buildPlan, runPublish });

    const result = await orchestrator.publish(ctx, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({ status: "needs-review", conflicts });
    expect(runPublish).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ phase: "needs-review", conflicts });
  });

  it("reports cancelled (without throwing) when the signal is aborted", async () => {
    const events: SyncProgress[] = [];
    const controller = new AbortController();
    controller.abort();
    const buildPlan = vi.fn(async () => makePlan());
    const runPublish = vi.fn(async () => {
      throw new Error("interrupted between objects");
    });
    const orchestrator = createSyncOrchestrator({ buildPlan, runPublish });

    const result = await orchestrator.publish(ctx, {
      signal: controller.signal,
      onProgress: (p) => events.push(p),
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(events.at(-1)?.phase).toBe("cancelled");
  });

  it("rethrows and emits a failed phase on a publish error", async () => {
    const events: SyncProgress[] = [];
    const buildPlan = vi.fn(async () => makePlan());
    const runPublish = vi.fn(async () => {
      throw new Error("network down");
    });
    const orchestrator = createSyncOrchestrator({ buildPlan, runPublish });

    await expect(orchestrator.publish(ctx, { onProgress: (p) => events.push(p) })).rejects.toThrow(
      /network down/,
    );
    expect(events.at(-1)).toMatchObject({ phase: "failed", error: "network down" });
  });
});

const pullInput = {
  driveId: "drv_owned",
  remoteSet: {} as RemoteSetIndexResult,
} satisfies ApplyRemoteSetPullInput;

function pullPreview(over: Partial<RemoteSetPullPreview> = {}): RemoteSetPullPreview {
  return {
    action: "apply-remote",
    remoteSetId: "ses_x",
    localSessionId: "ses_remote_drv_owned_ses_x",
    reasons: [],
    willMutate: true,
    trackCount: 3,
    bytes: 300,
    ...over,
  };
}

describe("createSyncOrchestrator.publish read-merge-write (MW-4)", () => {
  it("refetches the base, re-plans, and retries when a conditional write 412s", async () => {
    const events: SyncProgress[] = [];
    const baseA = {};
    const baseB = {};
    const bases = [baseA, baseB];
    const fetchPublishBase = vi.fn(async () => bases.shift() ?? {});
    const buildPlan = vi.fn(async (_input: R2ExportPlanForDriveInput) => makePlan());
    let runs = 0;
    const runPublish = vi.fn(async () => {
      runs += 1;
      if (runs === 1) throw new R2PublishHttpError("manifest.json", 412);
      return { runId: "run_2" };
    });
    const orchestrator = createSyncOrchestrator({ buildPlan, runPublish, fetchPublishBase });

    const result = await orchestrator.publish(ctx, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({ status: "completed", runId: "run_2" });
    // The race loser re-reads the remote state and merges instead of clobbering.
    expect(fetchPublishBase).toHaveBeenCalledTimes(2);
    expect(buildPlan).toHaveBeenCalledTimes(2);
    expect(buildPlan.mock.calls[0]?.[0]).toMatchObject({ remoteBase: baseA });
    expect(buildPlan.mock.calls[1]?.[0]).toMatchObject({ remoteBase: baseB });
    expect(events.map((e) => e.phase)).toEqual([
      "planning",
      "uploading",
      "planning",
      "uploading",
      "completed",
    ]);
  });

  it("gives up after bounded re-merge retries and fails", async () => {
    const fetchPublishBase = vi.fn(async () => ({}));
    const runPublish = vi.fn(async () => {
      throw new R2PublishHttpError("manifest.json", 412);
    });
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(async () => makePlan()),
      runPublish,
      fetchPublishBase,
    });

    await expect(orchestrator.publish(ctx)).rejects.toThrow(/HTTP 412/);
    expect(runPublish).toHaveBeenCalledTimes(3); // 1 + 2 bounded retries
  });

  it("does not refetch the base for a non-412 failure", async () => {
    const fetchPublishBase = vi.fn(async () => ({}));
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(async () => makePlan()),
      runPublish: vi.fn(async () => {
        throw new Error("network down");
      }),
      fetchPublishBase,
    });

    await expect(orchestrator.publish(ctx)).rejects.toThrow("network down");
    expect(fetchPublishBase).toHaveBeenCalledTimes(1);
  });
});

describe("createSyncOrchestrator.pull", () => {
  it("applies a mutating pull: planning -> applying -> completed", async () => {
    const events: SyncProgress[] = [];
    const dryRunPull = vi.fn(async () => pullPreview());
    const applyPull = vi.fn(
      async () =>
        ({
          ...pullPreview(),
          runId: "run_pull",
          sessionId: "ses_remote_drv_owned_ses_x",
          trackIds: ["t1", "t2", "t3"],
          cachedMedia: 0,
        }) as ApplyRemoteSetPullResult,
    );
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(),
      runPublish: vi.fn(),
      dryRunPull,
      applyPull,
    });

    const result = await orchestrator.pull(pullInput, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({
      status: "completed",
      mutated: true,
      runId: "run_pull",
      sessionId: "ses_remote_drv_owned_ses_x",
    });
    expect(events.map((e) => e.phase)).toEqual(["planning", "applying", "completed"]);
    expect(events.every((e) => e.direction === "pull")).toBe(true);
    expect(events.at(-1)).toMatchObject({ objectsDone: 3, objectsTotal: 3, bytesDone: 300 });
  });

  it("forwards the signal into applyPull and reports cancelled on abort (F6)", async () => {
    const events: SyncProgress[] = [];
    const controller = new AbortController();
    const dryRunPull = vi.fn(async () => pullPreview());
    const applyPull = vi.fn(async (input: ApplyRemoteSetPullInput) => {
      expect(input.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("R2 pull was cancelled.", "AbortError");
    });
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(),
      runPublish: vi.fn(),
      dryRunPull,
      applyPull: applyPull as never,
    });

    const result = await orchestrator.pull(pullInput, {
      signal: controller.signal,
      onProgress: (p) => events.push(p),
    });

    expect(result).toEqual({ status: "cancelled" });
    expect(events.at(-1)?.phase).toBe("cancelled");
  });

  it("is a no-op when nothing will mutate", async () => {
    const events: SyncProgress[] = [];
    const dryRunPull = vi.fn(async () =>
      pullPreview({ action: "unchanged", willMutate: false, trackCount: 0, bytes: 0 }),
    );
    const applyPull = vi.fn();
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(),
      runPublish: vi.fn(),
      dryRunPull,
      applyPull,
    });

    const result = await orchestrator.pull(pullInput, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({ status: "completed", mutated: false });
    expect(applyPull).not.toHaveBeenCalled();
    expect(events.at(-1)?.phase).toBe("completed");
  });

  it("reports needs-review on a conflict without applying", async () => {
    const conflict: RemoteSetConflict = {
      entityType: "set",
      entityId: "ses_x",
      reason: "local-and-remote-changed",
      localMutationIds: ["m1"],
    };
    const dryRunPull = vi.fn(async () =>
      pullPreview({ action: "conflict", willMutate: false, conflict, trackCount: 2, bytes: 200 }),
    );
    const applyPull = vi.fn();
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(),
      runPublish: vi.fn(),
      dryRunPull,
      applyPull,
    });

    const result = await orchestrator.pull(pullInput);

    expect(result).toEqual({ status: "needs-review", conflict });
    expect(applyPull).not.toHaveBeenCalled();
  });

  it("reports a blocked hash mismatch without applying", async () => {
    const events: SyncProgress[] = [];
    const dryRunPull = vi.fn(async () =>
      pullPreview({ action: "blocked", reason: "hash-mismatch", willMutate: false }),
    );
    const applyPull = vi.fn();
    const orchestrator = createSyncOrchestrator({
      buildPlan: vi.fn(),
      runPublish: vi.fn(),
      dryRunPull,
      applyPull,
    });

    const result = await orchestrator.pull(pullInput, { onProgress: (p) => events.push(p) });

    expect(result).toEqual({ status: "blocked", reason: "hash-mismatch" });
    expect(applyPull).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ phase: "failed", error: "hash-mismatch" });
  });

  it("throws when pull deps are not provided", async () => {
    const orchestrator = createSyncOrchestrator({ buildPlan: vi.fn(), runPublish: vi.fn() });
    await expect(orchestrator.pull(pullInput)).rejects.toThrow(/pull dependencies/);
  });
});

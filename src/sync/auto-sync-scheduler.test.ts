import { describe, expect, it, vi } from "vitest";
import type { CloudDrive } from "@/db/types";
import { createCloudAutoSyncScheduler, shouldRunAutoSync } from "./auto-sync-scheduler";

const writableDrive: CloudDrive = {
  id: "drv_auto",
  label: "Auto Drive",
  kind: "owned",
  provider: "r2",
  capabilities: {
    read: true,
    write: true,
    manageInvites: false,
    writeStats: true,
    writePresence: true,
  },
  autoSyncFrequency: "30min",
  uploadConcurrency: 2,
  createdAt: 0,
  updatedAt: 0,
};

describe("shouldRunAutoSync", () => {
  it("does not schedule manual, read-only, credential-less, running, hidden, offline, or paused drives", () => {
    const base = {
      drive: writableDrive,
      hasCredentials: true,
      isRunning: false,
      isVisible: true,
      isOnline: true,
      now: 60_000,
      appStartedAt: 0,
      jitterMs: 0,
    };

    expect(
      shouldRunAutoSync({ ...base, drive: { ...writableDrive, autoSyncFrequency: "manual" } }),
    ).toBe(false);
    expect(
      shouldRunAutoSync({
        ...base,
        drive: {
          ...writableDrive,
          capabilities: { ...writableDrive.capabilities, write: false },
        },
      }),
    ).toBe(false);
    expect(shouldRunAutoSync({ ...base, hasCredentials: false })).toBe(false);
    expect(shouldRunAutoSync({ ...base, isRunning: true })).toBe(false);
    expect(shouldRunAutoSync({ ...base, isVisible: false })).toBe(false);
    expect(shouldRunAutoSync({ ...base, isOnline: false })).toBe(false);
    expect(
      shouldRunAutoSync({
        ...base,
        drive: { ...writableDrive, autoSyncPausedAt: 1, autoSyncPauseReason: "failed" },
      }),
    ).toBe(false);
  });

  it("runs once after app-start delay", () => {
    const drive = { ...writableDrive, autoSyncFrequency: "app-start" as const };
    expect(
      shouldRunAutoSync({
        drive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 29_999,
        appStartedAt: 0,
        jitterMs: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoSync({
        drive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 30_000,
        appStartedAt: 0,
        jitterMs: 0,
      }),
    ).toBe(true);
    expect(
      shouldRunAutoSync({
        drive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 120_000,
        appStartedAt: 0,
        jitterMs: 0,
        lastAutoSyncStartedAt: 31_000,
      }),
    ).toBe(false);
  });

  it("honors interval frequency, jitter, failure backoff, and local-change debounce", () => {
    expect(
      shouldRunAutoSync({
        drive: writableDrive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 1_800_999,
        appStartedAt: 0,
        jitterMs: 1_000,
        lastAutoSyncStartedAt: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoSync({
        drive: writableDrive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 1_801_000,
        appStartedAt: 0,
        jitterMs: 1_000,
        lastAutoSyncStartedAt: 0,
      }),
    ).toBe(true);
    expect(
      shouldRunAutoSync({
        drive: writableDrive,
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 1_801_000,
        appStartedAt: 0,
        jitterMs: 0,
        lastAutoSyncStartedAt: 0,
        consecutiveFailures: 2,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoSync({
        drive: { ...writableDrive, autoSyncFrequency: "change-debounce" },
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 119_999,
        appStartedAt: 0,
        jitterMs: 0,
        pendingLocalChangesSince: 0,
      }),
    ).toBe(false);
    expect(
      shouldRunAutoSync({
        drive: { ...writableDrive, autoSyncFrequency: "change-debounce" },
        hasCredentials: true,
        isRunning: false,
        isVisible: true,
        isOnline: true,
        now: 120_000,
        appStartedAt: 0,
        jitterMs: 0,
        pendingLocalChangesSince: 0,
      }),
    ).toBe(true);
  });
});

describe("createCloudAutoSyncScheduler", () => {
  it("publishes due drives and records attempts", async () => {
    vi.useFakeTimers();
    const publishDrive = vi.fn(async () => undefined);
    const scheduler = createCloudAutoSyncScheduler({
      appStartedAt: 0,
      getDrives: async () => [{ ...writableDrive, autoSyncFrequency: "app-start" }],
      hasCredentials: async () => true,
      isDriveRunning: () => false,
      isVisible: () => true,
      isOnline: () => true,
      now: () => 30_000,
      jitterMs: () => 0,
      publishDrive,
    });

    await scheduler.tick();
    await scheduler.tick();

    expect(publishDrive).toHaveBeenCalledOnce();
    expect(publishDrive).toHaveBeenCalledWith("drv_auto");
    vi.useRealTimers();
  });
});

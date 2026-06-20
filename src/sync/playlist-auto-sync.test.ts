import { describe, expect, it } from "vitest";
import type { DjSession } from "@/db/types";
import {
  createPlaylistAutoSyncScheduler,
  PLAYLIST_SYNC_APP_START_DELAY_MS,
  type PlaylistSyncDecisionInput,
  shouldSyncPlaylist,
} from "./playlist-auto-sync";

const MIN = 60_000;

function decisionInput(
  overrides: Partial<PlaylistSyncDecisionInput> & {
    set?: Partial<PlaylistSyncDecisionInput["set"]>;
  } = {},
): PlaylistSyncDecisionInput {
  const { set: setOverrides, ...rest } = overrides;
  return {
    set: {
      streamPlaylistRef: { source: "bili", id: "fav_123" },
      autoSyncFrequency: "60min",
      ...setOverrides,
    },
    isRunning: false,
    isVisible: true,
    isOnline: true,
    now: 1_000_000,
    appStartedAt: 0,
    jitterMs: 0,
    ...rest,
  };
}

describe("shouldSyncPlaylist", () => {
  it("never syncs a set with no frequency / manual", () => {
    expect(shouldSyncPlaylist(decisionInput({ set: { autoSyncFrequency: undefined } }))).toBe(
      false,
    );
    expect(shouldSyncPlaylist(decisionInput({ set: { autoSyncFrequency: "manual" } }))).toBe(false);
  });

  it("never syncs a set with no bound playlist ref", () => {
    expect(shouldSyncPlaylist(decisionInput({ set: { streamPlaylistRef: undefined } }))).toBe(
      false,
    );
  });

  it("does not sync while hidden, offline, or already running", () => {
    expect(shouldSyncPlaylist(decisionInput({ isVisible: false }))).toBe(false);
    expect(shouldSyncPlaylist(decisionInput({ isOnline: false }))).toBe(false);
    expect(shouldSyncPlaylist(decisionInput({ isRunning: true }))).toBe(false);
  });

  describe("app-start", () => {
    const base = { set: { autoSyncFrequency: "app-start" as const } };

    it("waits the startup delay then fires once", () => {
      expect(
        shouldSyncPlaylist(
          decisionInput({ ...base, now: PLAYLIST_SYNC_APP_START_DELAY_MS - 1, appStartedAt: 0 }),
        ),
      ).toBe(false);
      expect(
        shouldSyncPlaylist(
          decisionInput({ ...base, now: PLAYLIST_SYNC_APP_START_DELAY_MS, appStartedAt: 0 }),
        ),
      ).toBe(true);
    });

    it("does not fire again once it has synced this launch", () => {
      expect(
        shouldSyncPlaylist(
          decisionInput({
            ...base,
            now: PLAYLIST_SYNC_APP_START_DELAY_MS + 5 * MIN,
            lastAutoSyncStartedAt: PLAYLIST_SYNC_APP_START_DELAY_MS,
          }),
        ),
      ).toBe(false);
    });
  });

  describe("interval cadence", () => {
    it("re-baselines at launch when nothing synced yet (waits one interval)", () => {
      expect(shouldSyncPlaylist(decisionInput({ now: 60 * MIN - 1, appStartedAt: 0 }))).toBe(false);
      expect(shouldSyncPlaylist(decisionInput({ now: 60 * MIN, appStartedAt: 0 }))).toBe(true);
    });

    it("waits a full interval after the last sync", () => {
      expect(
        shouldSyncPlaylist(
          decisionInput({ now: 100 * MIN + 59 * MIN, lastAutoSyncStartedAt: 100 * MIN }),
        ),
      ).toBe(false);
      expect(
        shouldSyncPlaylist(
          decisionInput({ now: 100 * MIN + 60 * MIN, lastAutoSyncStartedAt: 100 * MIN }),
        ),
      ).toBe(true);
    });

    it("honors the configured interval (15/30/60)", () => {
      expect(
        shouldSyncPlaylist(
          decisionInput({ set: { autoSyncFrequency: "15min" }, now: 15 * MIN, appStartedAt: 0 }),
        ),
      ).toBe(true);
      expect(
        shouldSyncPlaylist(
          decisionInput({ set: { autoSyncFrequency: "30min" }, now: 15 * MIN, appStartedAt: 0 }),
        ),
      ).toBe(false);
    });

    it("adds jitter to the threshold", () => {
      expect(
        shouldSyncPlaylist(decisionInput({ now: 60 * MIN, appStartedAt: 0, jitterMs: 5_000 })),
      ).toBe(false);
      expect(
        shouldSyncPlaylist(
          decisionInput({ now: 60 * MIN + 5_000, appStartedAt: 0, jitterMs: 5_000 }),
        ),
      ).toBe(true);
    });
  });

  describe("failure backoff", () => {
    it("holds off after consecutive failures, then resumes", () => {
      const last = 100 * MIN;
      // 1 failure → 15min base backoff window from last sync
      expect(
        shouldSyncPlaylist(
          decisionInput({
            now: last + 10 * MIN,
            lastAutoSyncStartedAt: last,
            consecutiveFailures: 1,
          }),
        ),
      ).toBe(false);
      // past the backoff AND past the interval → fires again
      expect(
        shouldSyncPlaylist(
          decisionInput({
            now: last + 61 * MIN,
            lastAutoSyncStartedAt: last,
            consecutiveFailures: 1,
          }),
        ),
      ).toBe(true);
    });
  });
});

describe("createPlaylistAutoSyncScheduler", () => {
  function makeSet(id: string, overrides: Partial<DjSession> = {}): DjSession {
    return {
      id,
      name: id,
      seedPrompt: "",
      trackIds: [],
      status: "idle",
      config: { autoExtend: false },
      displayMode: "video",
      streamPlaylistRef: { source: "bili", id: "fav_1" },
      autoSyncFrequency: "app-start",
      createdAt: 0,
      updatedAt: 0,
      ...overrides,
    } as DjSession;
  }

  it("syncs a due set once and skips it on the next tick (same launch)", async () => {
    const synced: string[] = [];
    const scheduler = createPlaylistAutoSyncScheduler({
      appStartedAt: 0,
      getSets: async () => [makeSet("ses_a")],
      isSetRunning: () => false,
      isVisible: () => true,
      isOnline: () => true,
      now: () => PLAYLIST_SYNC_APP_START_DELAY_MS,
      jitterMs: () => 0,
      syncSet: async (id) => {
        synced.push(id);
      },
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(synced).toEqual(["ses_a"]);
  });

  it("does not sync sets that are not bound / manual", async () => {
    const synced: string[] = [];
    const scheduler = createPlaylistAutoSyncScheduler({
      appStartedAt: 0,
      getSets: async () => [
        makeSet("ses_manual", { autoSyncFrequency: "manual" }),
        makeSet("ses_unbound", { streamPlaylistRef: undefined }),
      ],
      isSetRunning: () => false,
      isVisible: () => true,
      isOnline: () => true,
      now: () => PLAYLIST_SYNC_APP_START_DELAY_MS,
      jitterMs: () => 0,
      syncSet: async (id) => {
        synced.push(id);
      },
    });
    await scheduler.tick();
    expect(synced).toEqual([]);
  });

  it("counts a thrown sync as a failure (no crash) and records it for backoff", async () => {
    let calls = 0;
    const errors: unknown[] = [];
    const scheduler = createPlaylistAutoSyncScheduler({
      appStartedAt: 0,
      getSets: async () => [makeSet("ses_x", { autoSyncFrequency: "15min" })],
      isSetRunning: () => false,
      isVisible: () => true,
      isOnline: () => true,
      now: () => 15 * MIN,
      jitterMs: () => 0,
      syncSet: async () => {
        calls += 1;
        throw new Error("network");
      },
      onError: (e) => errors.push(e),
    });
    await scheduler.tick();
    expect(calls).toBe(1);
    expect(errors).toHaveLength(1);
  });
});

import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { createPerfCommandHandler, type PerfControlCommand } from "./perf-control-bridge";

// The control endpoint's main-process module (CJS; electron required lazily inside
// registerPerfControl) — loaded via require so the prod gate is regression-tested
// directly without pulling a .cjs through TS module resolution.
const { shouldEnablePerfControl, routeToCommand } = createRequire(import.meta.url)(
  "../../electron/perf-control.cjs",
) as {
  shouldEnablePerfControl: (input: {
    isPackaged?: boolean;
    env?: Record<string, string>;
  }) => boolean;
  routeToCommand: (
    method: string,
    segments: string[],
    body: Record<string, unknown>,
  ) => { kind: string; [k: string]: unknown } | null;
};

describe("shouldEnablePerfControl (prod regression guard)", () => {
  it("is NEVER enabled in a packaged build, even with the opt-in env", () => {
    expect(shouldEnablePerfControl({ isPackaged: true, env: { MUZERO_PERF_CONTROL: "1" } })).toBe(
      false,
    );
  });

  it("requires explicit opt-in even when unpackaged", () => {
    expect(shouldEnablePerfControl({ isPackaged: false, env: {} })).toBe(false);
    expect(shouldEnablePerfControl({ isPackaged: false, env: { MUZERO_PERF_CONTROL: "0" } })).toBe(
      false,
    );
  });

  it("enables only when unpackaged AND opted in", () => {
    expect(shouldEnablePerfControl({ isPackaged: false, env: { MUZERO_PERF_CONTROL: "1" } })).toBe(
      true,
    );
  });
});

describe("routeToCommand", () => {
  it("maps known routes", () => {
    expect(routeToCommand("GET", ["state"], {})).toEqual({ kind: "state" });
    expect(routeToCommand("POST", ["action", "playback.next"], { x: 1 })).toEqual({
      kind: "action",
      actionId: "playback.next",
      payload: { x: 1 },
    });
    expect(routeToCommand("POST", ["player", "playIndex"], { index: 5 })).toEqual({
      kind: "player",
      method: "playIndex",
      payload: { index: 5 },
    });
    expect(routeToCommand("POST", ["settings"], { theme: "light" })).toEqual({
      kind: "settings",
      patch: { theme: "light" },
    });
    expect(routeToCommand("POST", ["perf", "trace"], { since: 123, limit: 50 })).toEqual({
      kind: "dumpTrace",
      since: 123,
      limit: 50,
    });
    expect(routeToCommand("POST", ["live-request"], { action: "inject", query: "晴天" })).toEqual({
      kind: "liveRequest",
      payload: { action: "inject", query: "晴天" },
    });
    expect(routeToCommand("GET", ["sessions"], {})).toEqual({ kind: "sessions" });
  });

  it("returns null for unknown routes", () => {
    expect(routeToCommand("DELETE", ["state"], {})).toBeNull();
    expect(routeToCommand("GET", ["nope"], {})).toBeNull();
  });
});

function makeDeps(overrides: Partial<Parameters<typeof createPerfCommandHandler>[0]> = {}) {
  const playerState = {
    activeSessionId: "ses_1",
    queue: [{ id: "a" }, { id: "b" }, { id: "c" }],
    currentIndex: 1,
    isPlaying: true,
    wantPlay: true,
    playIndex: vi.fn(async () => {}),
    next: vi.fn(async () => {}),
    seek: vi.fn(),
  } as unknown as ReturnType<Parameters<typeof createPerfCommandHandler>[0]["getPlayerState"]>;
  return {
    getPlayerState: () => playerState,
    getNavState: () => ({ tab: "now", setTab: vi.fn() }) as never,
    runAction: vi.fn(() => true),
    listActionIds: () => ["playback.next", "nav.tabNow"],
    saveSettings: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => ({ flowEnabled: true })),
    emitMarker: vi.fn(),
    dumpTrace: vi.fn(async () => []),
    ...overrides,
    _playerState: playerState,
  } as never;
}

describe("createPerfCommandHandler", () => {
  it("state returns a snapshot", async () => {
    const handle = createPerfCommandHandler(makeDeps());
    await expect(handle({ kind: "state" })).resolves.toMatchObject({
      activeSessionId: "ses_1",
      queueLength: 3,
      currentIndex: 1,
      isPlaying: true,
      // Track ids around the cursor + tail, used by the live-request harness.
      currentTrackId: "b",
      nextTrackId: "c",
      lastTrackId: "c",
      upcomingTrackIds: ["c"],
    });
  });

  it("action dispatches to the command bus and reports unknown ids", async () => {
    const runAction = vi.fn((id: string) => id === "playback.next");
    const handle = createPerfCommandHandler(makeDeps({ runAction }));
    await expect(handle({ kind: "action", actionId: "playback.next" })).resolves.toEqual({
      ran: "playback.next",
    });
    await expect(handle({ kind: "action", actionId: "bogus" })).rejects.toThrow(/unknown actionId/);
  });

  it("player playIndex resolves relative offsets against currentIndex", async () => {
    const deps = makeDeps();
    const playerState = (
      deps as unknown as { _playerState: { playIndex: ReturnType<typeof vi.fn> } }
    )._playerState;
    const handle = createPerfCommandHandler(deps);
    await handle({ kind: "player", method: "playIndex", payload: { index: "+1" } });
    expect(playerState.playIndex).toHaveBeenCalledWith(2);
  });

  it("rejects player methods outside the allowlist", async () => {
    const handle = createPerfCommandHandler(makeDeps());
    await expect(
      handle({ kind: "player", method: "deleteSession" } as PerfControlCommand),
    ).rejects.toThrow(/not allowed/);
  });

  it("settings forwards the patch to saveSettings", async () => {
    const saveSettings = vi.fn(async () => undefined);
    const handle = createPerfCommandHandler(makeDeps({ saveSettings }));
    await handle({ kind: "settings", patch: { theme: "light" } });
    expect(saveSettings).toHaveBeenCalledWith({ theme: "light" });
  });

  it("dumpTrace forwards since/limit and wraps the entries", async () => {
    const dumpTrace = vi.fn(async () => [{ at: 1 }, { at: 2 }]);
    const handle = createPerfCommandHandler(makeDeps({ dumpTrace }));
    await expect(handle({ kind: "dumpTrace", since: 100, limit: 10 })).resolves.toEqual({
      count: 2,
      entries: [{ at: 1 }, { at: 2 }],
    });
    expect(dumpTrace).toHaveBeenCalledWith(100, 10);
  });

  it("liveRequest forwards the payload to the wired driver", async () => {
    const liveRequest = vi.fn(async () => ({ item: { status: "completed" } }));
    const handle = createPerfCommandHandler(makeDeps({ liveRequest }));
    await expect(
      handle({ kind: "liveRequest", payload: { action: "inject", query: "晴天" } }),
    ).resolves.toEqual({ item: { status: "completed" } });
    expect(liveRequest).toHaveBeenCalledWith({ action: "inject", query: "晴天" });
  });

  it("liveRequest throws when the driver is not wired", async () => {
    const handle = createPerfCommandHandler(makeDeps({ liveRequest: undefined }));
    await expect(handle({ kind: "liveRequest", payload: {} })).rejects.toThrow(/not wired/);
  });

  it("sessions forwards to the wired lister", async () => {
    const listSessions = vi.fn(async () => ({ sessions: [{ id: "ses_1", trackCount: 5000 }] }));
    const handle = createPerfCommandHandler(makeDeps({ listSessions }));
    await expect(handle({ kind: "sessions" })).resolves.toEqual({
      sessions: [{ id: "ses_1", trackCount: 5000 }],
    });
  });

  it("throws on unknown command kinds", async () => {
    const handle = createPerfCommandHandler(makeDeps());
    await expect(handle({ kind: "frobnicate" } as unknown as PerfControlCommand)).rejects.toThrow(
      /unknown command kind/,
    );
  });
});

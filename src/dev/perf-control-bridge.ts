// Renderer side of the dev-only control endpoint (PRD 20260615-dev-control-endpoint).
//
// Receives command envelopes from the Electron main process and routes them to the
// EXISTING action surface — the shortcut command bus, player-store actions, saveSettings
// — never re-implementing behavior. It is loaded only under import.meta.env.DEV (see
// App.tsx), so it is tree-shaken out of production builds entirely.
import { getSettings, getTrack, saveSettings, setTrackTags } from "@/db/repositories";
import { log } from "@/lib/logger";
import { resetRenderTrace, snapshotRenderTrace } from "@/lib/render-trace";
import { traceEvent } from "@/lib/trace";
import { readTraceArchiveEntries } from "@/lib/trace-archive";
import {
  createShortcutActionRunnerContext,
  listShortcutActionIds,
  runShortcutAction,
} from "@/shortcuts/actions";
import { useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { getSearchPerfSnapshot, resetSearchPerf } from "@/workers/search-client";
import { getSearchDriver } from "./search-drive";

export interface PerfControlCommand {
  kind:
    | "state"
    | "actions"
    | "action"
    | "settings"
    | "getSettings"
    | "navTab"
    | "player"
    | "marker"
    | "dumpTrace"
    | "search"
    | "editMeta"
    | "renderTrace";
  actionId?: string;
  payload?: Record<string, unknown>;
  patch?: Record<string, unknown>;
  tab?: string;
  method?: string;
  label?: string;
  meta?: Record<string, unknown>;
  /** dumpTrace: only return entries at/after this epoch ms. */
  since?: number;
  /** dumpTrace: cap returned entries (newest kept). */
  limit?: number;
}

interface PerfCommandHandlerDeps {
  getPlayerState: () => ReturnType<typeof usePlayerStore.getState>;
  getNavState: () => ReturnType<typeof useNavStore.getState>;
  runAction: (actionId: string) => boolean;
  listActionIds: () => string[];
  saveSettings: (patch: Record<string, unknown>) => Promise<unknown>;
  getSettings: () => Promise<Record<string, unknown>>;
  emitMarker: (label: string, meta?: Record<string, unknown>) => void;
  dumpTrace: (since?: number, limit?: number) => Promise<unknown[]>;
  /** Drive the ⌘F overlay for the search-perf scenario (open/close/type/reset/stats). */
  driveSearch?: (action: string, query?: string) => unknown;
  /** Edit the current track's metadata (tags) — drives the metadata-edit fan-out scenario. */
  editCurrentTrackMeta?: () => Promise<unknown>;
  /** Render-trace: "reset" clears per-surface commit counters; else snapshot them. */
  renderTrace?: (action?: string) => unknown;
}

/** Player-store methods the endpoint may invoke. A deliberate allowlist — no arbitrary
 * method dispatch. (Phase 4 widens this + adds a settings allowlist.) */
const PLAYER_METHODS = new Set([
  "playIndex",
  "next",
  "prev",
  "togglePlay",
  "play",
  "pause",
  "seek",
  "setVolume",
  "setActiveSession",
  "playSystemPlaylist",
  "setDisplayMode",
]);

function snapshot(deps: PerfCommandHandlerDeps) {
  const s = deps.getPlayerState();
  return {
    tab: deps.getNavState().tab,
    activeSessionId: s.activeSessionId,
    queueLength: s.queue.length,
    currentIndex: s.currentIndex,
    isPlaying: s.isPlaying,
    wantPlay: s.wantPlay,
    displayMode: s.displayMode,
  };
}

/** Resolve playIndex's `index`: absolute number, or "+N"/"-N" relative to current. */
function resolveIndex(raw: unknown, currentIndex: number): number {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" && /^[+-]\d+$/.test(raw)) {
    return currentIndex + Number.parseInt(raw, 10);
  }
  throw new Error(`invalid index: ${String(raw)}`);
}

async function runPlayer(
  deps: PerfCommandHandlerDeps,
  method: string,
  payload: Record<string, unknown>,
) {
  if (!PLAYER_METHODS.has(method)) throw new Error(`player method not allowed: ${method}`);
  const s = deps.getPlayerState() as unknown as Record<string, (...args: unknown[]) => unknown>;
  switch (method) {
    case "playIndex":
      await s.playIndex(resolveIndex(payload.index, deps.getPlayerState().currentIndex));
      break;
    case "seek":
      s.seek(Number(payload.sec ?? payload.value ?? 0));
      break;
    case "setVolume":
      s.setVolume(Number(payload.value ?? 0));
      break;
    case "setActiveSession":
      await s.setActiveSession(String(payload.sessionId));
      break;
    case "playSystemPlaylist":
      await s.playSystemPlaylist(String(payload.playlistId), payload.tracks ?? []);
      break;
    case "setDisplayMode":
      await s.setDisplayMode(String(payload.mode));
      break;
    default:
      await s[method]();
  }
  return { method, ...snapshot(deps) };
}

/** Pure command router — unit-tested with injected deps (no window / IPC). */
export function createPerfCommandHandler(deps: PerfCommandHandlerDeps) {
  return async function handle(command: PerfControlCommand): Promise<unknown> {
    switch (command.kind) {
      case "state":
        return snapshot(deps);
      case "actions":
        return { actions: deps.listActionIds() };
      case "action": {
        if (!command.actionId) throw new Error("actionId required");
        if (!deps.runAction(command.actionId)) {
          throw new Error(`unknown actionId: ${command.actionId}`);
        }
        return { ran: command.actionId };
      }
      case "navTab": {
        if (!command.tab) throw new Error("tab required");
        deps.getNavState().setTab(command.tab as never);
        return { tab: command.tab };
      }
      case "settings":
        await deps.saveSettings(command.patch ?? {});
        return { saved: Object.keys(command.patch ?? {}) };
      case "getSettings":
        return deps.getSettings();
      case "player":
        if (!command.method) throw new Error("method required");
        return runPlayer(deps, command.method, command.payload ?? {});
      case "marker":
        deps.emitMarker(command.label ?? "marker", command.meta);
        return { marked: command.label ?? "marker" };
      case "dumpTrace": {
        const entries = await deps.dumpTrace(command.since, command.limit);
        return { count: entries.length, entries };
      }
      case "search": {
        if (!deps.driveSearch) throw new Error("search driver not registered");
        const action = String(command.payload?.action ?? "");
        const query = command.payload?.query as string | undefined;
        return { search: action, data: deps.driveSearch(action, query) ?? null };
      }
      case "editMeta": {
        if (!deps.editCurrentTrackMeta) throw new Error("editMeta not wired");
        return { editMeta: (await deps.editCurrentTrackMeta()) ?? null };
      }
      case "renderTrace": {
        if (!deps.renderTrace) throw new Error("renderTrace not wired");
        return deps.renderTrace(command.payload?.action as string | undefined) ?? null;
      }
      default:
        throw new Error(`unknown command kind: ${String((command as { kind?: string }).kind)}`);
    }
  };
}

interface PerfControlApi {
  onCommand: (cb: (msg: { id: string; command: PerfControlCommand }) => void) => () => void;
  sendResult: (payload: { id: string; ok: boolean; data?: unknown; error?: string }) => void;
}

let installed = false;

/** Idempotently subscribe the bridge to the preload relay. No-op without the dev endpoint. */
export function startPerfControlBridge(): void {
  if (installed) return;
  const api = (window as unknown as { muzero?: { perfControl?: PerfControlApi } }).muzero
    ?.perfControl;
  if (!api) return;
  installed = true;

  const handle = createPerfCommandHandler({
    getPlayerState: usePlayerStore.getState,
    getNavState: useNavStore.getState,
    runAction: (actionId) =>
      runShortcutAction(actionId, createShortcutActionRunnerContext(useNavStore.getState().setTab)),
    listActionIds: listShortcutActionIds,
    saveSettings: (patch) => saveSettings(patch as never),
    // Whitelist of non-secret display/perf settings — NEVER return BYOK keys/endpoints
    // over the control endpoint (CLAUDE.md rule 2). Enough for switch-fps A/B snapshots.
    getSettings: async () => {
      const s = (await getSettings()) as unknown as Record<string, unknown>;
      const keys = [
        "flowEnabled",
        "flowEffect",
        "flowOpacity",
        "flowDim",
        "visualizerStyle",
        "visualizerAsBackground",
        "visualizerIdleOnly",
        "theme",
        "reducedMotion",
        "coverCropped",
      ];
      return Object.fromEntries(keys.map((k) => [k, s[k]]));
    },
    emitMarker: (label, meta) =>
      traceEvent("debug", "perf.control", "marker", { label, ...(meta ?? {}) }),
    driveSearch: (action, query) => {
      if (action === "reset") {
        resetSearchPerf();
        return null;
      }
      if (action === "stats") return getSearchPerfSnapshot();
      const driver = getSearchDriver();
      if (!driver) throw new Error("search overlay driver not mounted");
      switch (action) {
        case "open":
          driver.setOpen(true);
          return null;
        case "close":
          driver.setOpen(false);
          return null;
        case "type":
          driver.setQuery(query ?? "");
          return null;
        default:
          throw new Error(`unknown search action: ${action}`);
      }
    },
    // Edit the CURRENT track's tags with a fresh value each call → a real `tracks` row
    // write, the scenario-4 (metadata edit) fan-out probe. PRD scalable-track-list §4.
    editCurrentTrackMeta: async () => {
      const s = usePlayerStore.getState();
      const id = s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined;
      if (!id) return { edited: null };
      const tag = `perf-${(await getTrack(id))?.tags?.length ?? 0}-${s.currentIndex}`;
      await setTrackTags(id, [tag]);
      return { edited: id };
    },
    // Render-trace: reset per-surface commit counters before a scenario, snapshot after
    // — surfaces shows which re-rendered (and whether a hidden one wasted work).
    renderTrace: (action) => {
      if (action === "reset") {
        resetRenderTrace();
        return { reset: true };
      }
      return { entries: snapshotRenderTrace() };
    },
    dumpTrace: async (since, limit) => {
      const entries = await readTraceArchiveEntries(undefined, limit ?? 5000);
      return since != null ? entries.filter((e) => e.at >= since) : entries;
    },
  });

  api.onCommand(({ id, command }) => {
    void handle(command)
      .then((data) => api.sendResult({ id, ok: true, data }))
      .catch((error: unknown) =>
        api.sendResult({ id, ok: false, error: String((error as Error)?.message ?? error) }),
      );
  });
  log.info("perf.control", "perf-control bridge installed");
}

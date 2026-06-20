// Renderer side of the dev-only control endpoint (PRD 20260615-dev-control-endpoint).
//
// Receives command envelopes from the Electron main process and routes them to the
// EXISTING action surface — the shortcut command bus, player-store actions, saveSettings
// — never re-implementing behavior. It is loaded only under import.meta.env.DEV (see
// App.tsx), so it is tree-shaken out of production builds entirely.
import {
  createSession,
  createUploadedTrack,
  getSettings,
  getTrack,
  prependTrackIds,
  saveSettings,
  setTrackTags,
} from "@/db/repositories";
import { DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS, type StreamSourceId } from "@/db/types";
import { EXAMPLE_TRACK_TITLE, loadExampleTrackAssets } from "@/lib/example-track";
import { log } from "@/lib/logger";
import { fallbackUploadMediaMetadata } from "@/lib/media-metadata";
import {
  getPerformanceTraceSamplerStatus,
  startPerformanceTraceSampler,
  stopPerformanceTraceSampler,
} from "@/lib/performance-trace-sampler";
import { resetRenderTrace, snapshotRenderTrace } from "@/lib/render-trace";
import { getTraceEntries, type TraceEntry, traceEvent } from "@/lib/trace";
import { readTraceArchiveEntries } from "@/lib/trace-archive";
import {
  createShortcutActionRunnerContext,
  listShortcutActionIds,
  runShortcutAction,
} from "@/shortcuts/actions";
import { normalizeTab, useNavStore } from "@/stores/nav-store";
import { usePlayerStore } from "@/stores/player-store";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
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
    | "perfSampler"
    | "search"
    | "editMeta"
    | "renderTrace"
    | "liveRequest"
    | "sessions"
    | "seedExample"
    | "streamProbe";
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
  perfSampler?: (payload: Record<string, unknown>) => unknown;
  /** Drive the ⌘F overlay for the search-perf scenario (open/close/type/reset/stats). */
  driveSearch?: (action: string, query?: string) => unknown;
  /** Edit the current track's metadata (tags) — drives the metadata-edit fan-out scenario. */
  editCurrentTrackMeta?: () => Promise<unknown>;
  /** Render-trace: "reset" clears per-surface commit counters; else snapshot them. */
  renderTrace?: (action?: string) => unknown;
  /** Live-request harness: "sample" lists queued tracks to query; "inject" routes one. */
  liveRequest?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** List sessions (id/name/trackCount) so a perf run can switch playlists by size. */
  listSessions?: () => Promise<unknown>;
  /** Seed a small playable set for harnesses that run against a fresh profile DB. */
  seedExample?: () => Promise<unknown>;
  /** Probe a stream source's video resolve/quality-list against the live API (dev E2E). */
  streamProbe?: (payload: Record<string, unknown>) => Promise<unknown>;
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

const PERF_NAV_TAB_ALIASES = new Set(["sets"]);

function normalizePerfNavTab(tab: string): ReturnType<typeof normalizeTab> {
  const normalized = normalizeTab(tab);
  if (normalized !== "search" || tab === "search" || PERF_NAV_TAB_ALIASES.has(tab)) {
    return normalized;
  }
  throw new Error(`unknown tab: ${tab}`);
}

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
    // Track ids around the cursor + queue tail — lets the live-request harness verify
    // a routed match actually landed (play-now → current, play-next → next, append → last).
    currentTrackId: s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined,
    nextTrackId: s.currentIndex >= 0 ? s.queue[s.currentIndex + 1]?.id : undefined,
    lastTrackId: s.queue[s.queue.length - 1]?.id,
    // The next few upcoming ids — play-next appends to a FIFO request block after the
    // current track, so a routed match may land a slot or two past nextTrackId.
    upcomingTrackIds: s.queue.slice(s.currentIndex + 1, s.currentIndex + 9).map((t) => t.id),
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
        const tab = normalizePerfNavTab(command.tab);
        deps.getNavState().setTab(tab);
        return { tab };
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
      case "perfSampler": {
        if (!deps.perfSampler) throw new Error("perfSampler not wired");
        return deps.perfSampler(command.payload ?? {});
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
      case "liveRequest": {
        if (!deps.liveRequest) throw new Error("liveRequest not wired");
        return deps.liveRequest(command.payload ?? {});
      }
      case "sessions": {
        if (!deps.listSessions) throw new Error("listSessions not wired");
        return deps.listSessions();
      }
      case "seedExample": {
        if (!deps.seedExample) throw new Error("seedExample not wired");
        return deps.seedExample();
      }
      case "streamProbe": {
        if (!deps.streamProbe) throw new Error("streamProbe not wired");
        return deps.streamProbe(command.payload ?? {});
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
      traceEvent("debug", "perf.control", "marker", {
        label,
        perfNow: performance.now(),
        ...(meta ?? {}),
      }),
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
    // Live-request harness: drive the REAL singleton intake controller in this renderer
    // so route=search + each playbackAction exercises the live library search + player.
    //   { action: "sample", count? }            → queued tracks {id,title} to query with
    //   { action: "inject", query, routeMode?, playbackAction? } → routes one, returns item
    liveRequest: async (payload) => {
      const action = String(payload.action ?? "");
      if (action === "sample") {
        const s = usePlayerStore.getState();
        const count = Number(payload.count ?? 8);
        const step = Math.max(1, Math.floor(s.queue.length / (count + 1)));
        const out: Array<{ id: string; title: string; index: number }> = [];
        for (let i = 1; i <= count && out.length < count; i++) {
          const index = (s.currentIndex >= 0 ? s.currentIndex : 0) + i * step;
          const t = s.queue[index];
          if (t?.title) out.push({ id: t.id, title: t.title, index });
        }
        return { samples: out };
      }
      if (action === "inject") {
        const { driveLiveRequest } = await import("@/live-requests/live-request-controller");
        const item = await driveLiveRequest({
          query: String(payload.query ?? ""),
          routeMode: payload.routeMode as never,
          playbackAction: payload.playbackAction as never,
        });
        return { item };
      }
      if (action === "setApproval") {
        // Safe renderer-side read-modify-write: flip ONLY requireApprovalForPlayNow while
        // preserving the rest of the intake config (sources, authToken) — saveSettings
        // shallow-merges, so we must hand back the full object. Returns the prior value so
        // the harness can restore it. authToken never crosses the wire.
        const settings = await getSettings();
        const intake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
        const previous = intake.requireApprovalForPlayNow;
        await saveSettings({
          audienceRequestIntake: { ...intake, requireApprovalForPlayNow: Boolean(payload.value) },
        });
        return { previousRequireApproval: previous };
      }
      throw new Error(`unknown liveRequest action: ${action}`);
    },
    // List sessions (largest first) so a perf run can pick playlists by size and switch
    // between them with /player/setActiveSession to measure switch cost vs. queue length.
    listSessions: async () => {
      const { listSessions } = await import("@/db/repositories");
      const sessions = await listSessions();
      return {
        sessions: sessions
          .map((s) => ({
            id: s.id,
            name: s.name,
            trackCount: s.trackIds.length,
            autoExtend: s.config?.autoExtend ?? false,
          }))
          .sort((a, b) => b.trackCount - a.trackCount),
      };
    },
    // Probe a stream source's video resolve against the LIVE API (dev E2E for the
    // video-download work). Builds the source the same way the app does; returns only
    // sanitized shape (heights/codecs/mime/header-keys) — never the signed URL or cookie.
    streamProbe: async (payload) => {
      const sourceId = String(payload.sourceId ?? "bili") as StreamSourceId;
      const settings = (await getSettings()) as {
        streamSources?: Record<string, { cookie?: string } | undefined>;
      };
      const source = createStreamSource(sourceId, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (id) => settings.streamSources?.[id]?.cookie,
      });
      if (!source) throw new Error(`source ${sourceId} unavailable`);

      // Resolve a live externalId: explicit, or the first hit of a real search.
      let externalId = String(payload.externalId ?? "");
      let searchHits: Array<{ externalId: string; title: string }> = [];
      if (!externalId && payload.search) {
        const hits = await source.search(String(payload.search), { limit: 5 });
        searchHits = hits.map((h) => ({ externalId: h.externalId, title: h.title }));
        externalId = hits[0]?.externalId ?? "";
      }
      if (!externalId) throw new Error("externalId or search required");

      // Audio resolve is the known-good baseline; comparing isolates video-path issues.
      const audioRes = await source.resolve(externalId, {});
      const audio =
        audioRes.kind === "ok"
          ? { kind: "ok", mime: audioRes.stream.mime, quality: audioRes.stream.quality }
          : audioRes;

      const qualities = source.listVideoQualities
        ? await source.listVideoQualities(externalId)
        : [];
      let video: unknown = { kind: "no-resolveVideo" };
      if (source.resolveVideo) {
        const r = await source.resolveVideo(externalId, {
          quality: payload.quality as string | undefined,
        });
        video =
          r.kind === "ok"
            ? {
                kind: "ok",
                height: r.video.height,
                width: r.video.width,
                fps: r.video.fps,
                codec: r.video.codec,
                mime: r.video.mime,
                bandwidth: r.video.bandwidth,
                hasUrl: Boolean(r.video.url),
                headerKeys: Object.keys(r.video.headers ?? {}),
                expiresAt: r.video.expiresAt,
              }
            : r;
      }
      return { sourceId, externalId, searchHits, audio, qualities, video };
    },
    seedExample: async () => {
      const session = await createSession({
        name: "Playback Memory Harness",
        seedPrompt: "",
        config: { autoExtend: false },
        displayMode: "cover",
      });
      const { audio, cover } = await loadExampleTrackAssets();
      const track = await createUploadedTrack({
        sessionId: session.id,
        title: EXAMPLE_TRACK_TITLE,
        kind: "audio",
        blob: audio,
        mime: audio.type || "audio/mpeg",
        durationSec: 0,
        mediaMetadata: fallbackUploadMediaMetadata(audio, EXAMPLE_TRACK_TITLE),
        embeddedCover: cover,
      });
      await prependTrackIds(session.id, [track.id]);
      await usePlayerStore.getState().setActiveSession(session.id);
      return { sessionId: session.id, trackId: track.id };
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
      const entries = mergeTraceEntries(await readTraceArchiveEntries(undefined, limit ?? 5000), [
        ...getTraceEntries(),
      ]);
      const sliced = since != null ? entries.filter((e) => e.at >= since) : entries;
      return sliced.slice(-(limit ?? 5000));
    },
    perfSampler: (payload) => {
      const action = String(payload.action ?? "status");
      if (action === "start") {
        return startPerformanceTraceSampler({
          label: typeof payload.label === "string" ? payload.label : "perf-control",
          resetCounters: payload.resetCounters !== false,
        }).snapshot();
      }
      if (action === "stop") return stopPerformanceTraceSampler();
      if (action === "status") return getPerformanceTraceSamplerStatus();
      throw new Error(`unknown perfSampler action: ${action}`);
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

function mergeTraceEntries(entries: TraceEntry[], liveEntries: TraceEntry[]): TraceEntry[] {
  const byKey = new Map<string, TraceEntry>();
  for (const entry of [...entries, ...liveEntries]) {
    byKey.set(`${entry.at}:${entry.id}`, entry);
  }
  return [...byKey.values()].sort((a, b) => a.at - b.at || a.id - b.id);
}

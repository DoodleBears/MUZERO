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
import { resolveDesktopBridge } from "@/lib/desktop/bridge";
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
import { useNotificationStore } from "@/stores/notification-store";
import { usePlayerStore } from "@/stores/player-store";
import { buildDownloadPlan } from "@/streamsrc/download-plan";
import {
  downloadStreamedVideoToLibrary,
  recoverStreamedTrackCover,
} from "@/streamsrc/download-to-library";
import { createStreamSource } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { parseBareStreamId, parseStreamLink } from "@/streamsrc/stream-link";
import { getVoiceInputController } from "@/voice/voice-input-runtime";
import { getSearchPerfSnapshot, resetSearchPerf } from "@/workers/search-client";
import { muxCopyTracksViaWorker } from "@/workers/video-mux-client";
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
    | "streamProbe"
    | "streamDownload"
    | "downloadToLibrary"
    | "recoverCover"
    | "resolveLink"
    | "syncPlaylists"
    | "downloadQueue"
    | "playbackContext"
    | "voiceTranscript"
    | "notifications";
  actionId?: string;
  /** voiceTranscript: the text to feed into the voice→DJ pipeline (no mic). */
  text?: string;
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
  /** Voice-DJ E2E: feed a transcript into the voice pipeline as if spoken (no mic). */
  injectVoiceTranscript?: (text: string) => void;
  /** Read the current notification queue (the dj_say reply lands here). */
  readNotifications?: () => unknown;
  /** List sessions (id/name/trackCount) so a perf run can switch playlists by size. */
  listSessions?: () => Promise<unknown>;
  /** Seed a small playable set for harnesses that run against a fresh profile DB. */
  seedExample?: () => Promise<unknown>;
  /** Probe a stream source's video resolve/quality-list against the live API (dev E2E). */
  streamProbe?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Full download E2E: resolve video+audio, fetch bytes, copy-remux, return sizes. */
  streamDownload?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Download a streamed video INTO the library (task #9): creates a playable track. */
  downloadToLibrary?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Backfill an existing streamed track's official cover (no video re-download). */
  recoverCover?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Detect a link / bare id and resolve it targeted (getTracksByIds) — paste-to-resolve. */
  resolveLink?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** List a source's user playlists (Bilibili 收藏夹 sync); optional `importId` to import one. */
  syncPlaylists?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Drive/inspect the persistent download queue (list/enqueue/seedActive/recover/clearAll). */
  downloadQueue?: (payload: Record<string, unknown>) => Promise<unknown>;
  /** Playback-queue-model E2E: seed a cross-set scenario / play a track in a set context. */
  playbackContext?: (payload: Record<string, unknown>) => Promise<unknown>;
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
  "setShuffle",
  "setRepeat",
]);

const PERF_NAV_TAB_ALIASES = new Set(["sets"]);

function normalizePerfNavTab(tab: string): ReturnType<typeof normalizeTab> {
  const normalized = normalizeTab(tab);
  if (normalized !== "search" || tab === "search" || PERF_NAV_TAB_ALIASES.has(tab)) {
    return normalized;
  }
  throw new Error(`unknown tab: ${tab}`);
}

/** Flatten the active QueueSource for the wire (playback-queue-model E2E). */
function serializeQueueSource(source: ReturnType<typeof usePlayerStore.getState>["queueSource"]) {
  if (!source) return null;
  switch (source.kind) {
    case "set":
      return { kind: source.kind, setId: source.setId };
    case "system-playlist":
      return { kind: source.kind, id: source.id };
    case "entity":
      return { kind: source.kind, entityKind: source.entityKind, entityKey: source.entityKey };
    case "online-playlist":
      return { kind: source.kind, playlistId: source.playlist.id, source: source.playlist.source };
    default:
      return { kind: source.kind };
  }
}

function snapshot(deps: PerfCommandHandlerDeps) {
  const s = deps.getPlayerState();
  return {
    tab: deps.getNavState().tab,
    activeSessionId: s.activeSessionId,
    queueSource: serializeQueueSource(s.queueSource),
    shuffle: s.shuffle,
    queueLength: s.queue.length,
    queueTrackIds: s.queue.map((t) => t.id),
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
    case "setShuffle":
      await s.setShuffle(Boolean(payload.on));
      break;
    case "setRepeat":
      s.setRepeat(String(payload.mode ?? "all"));
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
      case "voiceTranscript": {
        if (!deps.injectVoiceTranscript) throw new Error("injectVoiceTranscript not wired");
        const text = String(command.text ?? command.payload?.text ?? "").trim();
        if (!text) throw new Error("text required");
        deps.injectVoiceTranscript(text);
        return { injected: text };
      }
      case "notifications": {
        if (!deps.readNotifications) throw new Error("readNotifications not wired");
        return deps.readNotifications();
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
      case "streamDownload": {
        if (!deps.streamDownload) throw new Error("streamDownload not wired");
        return deps.streamDownload(command.payload ?? {});
      }
      case "downloadToLibrary": {
        if (!deps.downloadToLibrary) throw new Error("downloadToLibrary not wired");
        return deps.downloadToLibrary(command.payload ?? {});
      }
      case "recoverCover": {
        if (!deps.recoverCover) throw new Error("recoverCover not wired");
        return deps.recoverCover(command.payload ?? {});
      }
      case "resolveLink": {
        if (!deps.resolveLink) throw new Error("resolveLink not wired");
        return deps.resolveLink(command.payload ?? {});
      }
      case "syncPlaylists": {
        if (!deps.syncPlaylists) throw new Error("syncPlaylists not wired");
        return deps.syncPlaylists(command.payload ?? {});
      }
      case "downloadQueue": {
        if (!deps.downloadQueue) throw new Error("downloadQueue not wired");
        return deps.downloadQueue(command.payload ?? {});
      }
      case "playbackContext": {
        if (!deps.playbackContext) throw new Error("playbackContext not wired");
        return deps.playbackContext(command.payload ?? {});
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
    injectVoiceTranscript: (text) => getVoiceInputController().injectTranscript(text),
    // dj_say replies land in the notification queue — surfaced for the voice E2E.
    readNotifications: () => ({
      queue: useNotificationStore.getState().queue.map((n) => ({
        id: n.id,
        type: n.type,
        message: n.message,
        actions: n.actions?.map((a) => a.label),
      })),
    }),
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
        case "filter":
          // `query` carries the FilterOption id (e.g. "video"/"local"/"online"); "" / "clear" clears.
          driver.setFilter?.(query ?? null);
          return null;
        case "snapshot":
          return driver.snapshot?.() ?? null;
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

      // listVideoQualities is light (metadata only) for both sources. resolveVideo is NOT
      // probed here — for YouTube it downloads the whole stream; use /stream/download for
      // the full resolve→fetch→mux E2E.
      const qualities = source.listVideoQualities
        ? await source.listVideoQualities(externalId)
        : [];
      return { sourceId, externalId, searchHits, audio, qualities };
    },
    // Full download E2E: resolve video+audio → fetch bytes via the media proxy → copy-remux
    // with mediabunny → report sizes (no DB write; this proves the runtime mux path). To keep
    // the byte download small, `search` picks the SHORTEST hit.
    streamDownload: async (payload) => {
      const sourceId = String(payload.sourceId ?? "bili") as StreamSourceId;
      const settings = (await getSettings()) as {
        streamSources?: Record<string, { cookie?: string } | undefined>;
      };
      const source = createStreamSource(sourceId, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (id) => settings.streamSources?.[id]?.cookie,
      });
      if (!source?.resolveVideo) throw new Error(`source ${sourceId} has no resolveVideo`);

      let externalId = String(payload.externalId ?? "");
      let picked: { title?: string; durationSec?: number } | undefined;
      if (!externalId && payload.search) {
        const hits = await source.search(String(payload.search), { limit: 10 });
        const byDur = hits
          .filter((h) => (h.durationSec ?? 0) > 0)
          .sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0));
        const hit = byDur[0] ?? hits[0];
        picked = hit ? { title: hit.title, durationSec: hit.durationSec } : undefined;
        externalId = hit?.externalId ?? "";
      }
      if (!externalId) throw new Error("externalId or search required");

      const videoRes = await source.resolveVideo(externalId, {
        quality: payload.quality as string | undefined,
      });
      if (videoRes.kind !== "ok") return { stage: "resolveVideo", result: videoRes };
      const audioRes = await source.resolve(externalId, {});
      if (audioRes.kind !== "ok") return { stage: "resolveAudio", result: audioRes };

      const plan = buildDownloadPlan(videoRes.video, audioRes.stream);
      if (plan.strategy.kind !== "copy") return { stage: "strategy", strategy: plan.strategy };

      const bridge = resolveDesktopBridge();
      const fetchBytes = async (url: string, headers?: Record<string, string>): Promise<Blob> => {
        const proxied = bridge.mediaProxyUrl ? bridge.mediaProxyUrl(url, headers) : url;
        const resp = await fetch(proxied);
        if (!resp.ok) throw new Error(`fetch ${resp.status}`);
        return resp.blob();
      };
      // YouTube returns bytes (blob transport); Bilibili returns a URL to fetch.
      const [videoBlob, audioBlob] = await Promise.all([
        videoRes.video.blob ?? fetchBytes(videoRes.video.url ?? "", videoRes.video.headers),
        audioRes.stream.blob ?? fetchBytes(audioRes.stream.mediaUrl ?? "", audioRes.stream.headers),
      ]);
      const muxed = await muxCopyTracksViaWorker(videoBlob, audioBlob, plan.strategy.container);
      // Persist to the app's media storage so the file is KEPT (not just measured).
      let savedStorageKey: string | undefined;
      let savedBytes: number | undefined;
      if (payload.save !== false && bridge.writeMediaStorageBlob) {
        const safeId = externalId.replace(/[^\w.-]/g, "_");
        savedStorageKey = `downloads/${safeId}-${videoRes.video.height ?? 0}p.${plan.strategy.container}`;
        await bridge.writeMediaStorageBlob({ storageKey: savedStorageKey, blob: muxed });
        savedBytes = (await bridge.statMediaStorageFile?.({ storageKey: savedStorageKey }))?.bytes;
      }
      return {
        externalId,
        title: picked?.title,
        durationSec: picked?.durationSec,
        container: plan.strategy.container,
        height: videoRes.video.height,
        codec: videoRes.video.codec,
        videoBytes: videoBlob.size,
        audioBytes: audioBlob.size,
        muxedBytes: muxed.size,
        muxedType: muxed.type,
        savedStorageKey,
        savedBytes,
      };
    },
    // Download a streamed video INTO the library (task #9): ensure a "Downloads" set,
    // run the real persist-to-track path, and read the track back for verification.
    downloadToLibrary: async (payload) => {
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

      let externalId = String(payload.externalId ?? "");
      let title = String(payload.title ?? "");
      let meta: import("@/db/types").StreamSourceMeta | undefined;
      let coverUrl: string | undefined;
      if (!externalId && payload.search) {
        const [hit] = await source.search(String(payload.search), { limit: 1 });
        externalId = hit?.externalId ?? "";
        title = hit?.title ?? externalId;
        meta = hit
          ? {
              artist: hit.artist,
              album: hit.album,
              coverUrl: hit.coverUrl,
              durationSec: hit.durationSec,
            }
          : undefined;
        coverUrl = hit?.coverUrl;
      }
      if (!externalId) throw new Error("externalId or search required");
      if (!title) title = externalId;

      const { createSession: createSess, listSessions } = await import("@/db/repositories");
      const sessions = await listSessions();
      const existing = sessions.find((s) => s.name === "Downloads");
      const session =
        existing ??
        (await createSess({
          name: "Downloads",
          seedPrompt: "",
          config: { autoExtend: false },
          displayMode: "video",
        }));

      const bridge = resolveDesktopBridge();
      const progressSamples: Array<{ stage: string; ratio: number }> = [];
      const result = await downloadStreamedVideoToLibrary(
        {
          source,
          sessionId: session.id,
          externalId,
          title,
          meta,
          coverUrl,
          quality:
            (payload.quality as string | undefined) ??
            (settings as { defaultVideoQuality?: string }).defaultVideoQuality ??
            "1080",
          audioOnly: Boolean(payload.audioOnly),
        },
        {
          fetchBytes: async (url, headers, onBytes) => {
            const proxied = bridge.mediaProxyUrl ? bridge.mediaProxyUrl(url, headers) : url;
            const resp = await fetch(proxied);
            if (!resp.ok) throw new Error(`fetch ${resp.status}`);
            const total =
              Number(
                resp.headers.get("content-length") || resp.headers.get("x-muzero-content-length"),
              ) || 0;
            if (!onBytes || !total || !resp.body) return resp.blob();
            const reader = resp.body.getReader();
            const chunks: BlobPart[] = [];
            let loaded = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                chunks.push(value);
                loaded += value.length;
                onBytes(loaded, total);
              }
            }
            return new Blob(chunks, { type: resp.headers.get("content-type") ?? "" });
          },
          mux: (v, a, container) => muxCopyTracksViaWorker(v, a, container),
          posterFrame: async (video, durationSec) => {
            const { extractUsefulVideoPosterFrame } = await import("@/lib/video-poster-frame");
            const file = new File([video], "download.mp4", { type: video.type || "video/mp4" });
            const poster = await extractUsefulVideoPosterFrame(file, { durationSec });
            return poster ? { blob: poster.blob, mime: poster.mime } : null;
          },
          onProgress: (stage, ratio) => {
            progressSamples.push({ stage, ratio: Math.round(ratio * 100) / 100 });
          },
        },
      );

      const track = result.kind === "downloaded" ? await getTrack(result.trackId) : null;
      return {
        sessionId: session.id,
        result,
        fetchProgressSamples: progressSamples.filter((s) => s.stage === "fetch").length,
        lastFetchRatio: progressSamples.filter((s) => s.stage === "fetch").at(-1)?.ratio ?? null,
        track: track
          ? {
              id: track.id,
              title: track.title,
              kind: track.kind,
              origin: track.origin,
              hasBlob: Boolean(track.blobId),
              hasCover: Boolean(track.coverBlobId),
              remoteCoverUrl: track.remoteCoverUrl,
              durationSec: track.durationSec,
              downloadedVideoHeight: track.downloadedVideoHeight,
              downloadedContainer: track.downloadedContainer,
              downloadedCodecs: track.downloadedCodecs,
            }
          : null,
      };
    },
    // Detect a link / bare id (mirrors the ⌘F overlay) and resolve it targeted via the
    // source's getTracksByIds — proves "paste URL / type BV → the right video, no keyword search".
    resolveLink: async (payload) => {
      const text = String(payload.text ?? "");
      const ref = parseStreamLink(text) ?? parseBareStreamId(text);
      if (!ref) return { ref: null, hit: null };
      const settings = (await getSettings()) as {
        streamSources?: Record<string, { cookie?: string } | undefined>;
      };
      const source = createStreamSource(ref.source, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (id) => settings.streamSources?.[id]?.cookie,
      });
      if (ref.kind === "playlist") {
        const playlist = (await source?.getPlaylistMeta?.(ref.id)) ?? null;
        const items = (await source?.importPlaylist?.(ref.id)) ?? [];
        return {
          ref,
          playlist,
          itemCount: items.length,
          sample: items.slice(0, 3).map((h) => ({ externalId: h.externalId, title: h.title })),
        };
      }
      if (!source?.getTracksByIds) return { ref, hit: null };
      const [hit] = await source.getTracksByIds([ref.id]);
      return { ref, hit: hit ?? null };
    },
    // List a source's user playlists (Bilibili 收藏夹 sync); `importId` imports one to hits.
    syncPlaylists: async (payload) => {
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
      const playlists = (await source.getUserPlaylists?.()) ?? [];
      let imported: unknown = null;
      if (payload.importId) {
        const hits = (await source.importPlaylist?.(String(payload.importId))) ?? [];
        imported = {
          count: hits.length,
          sample: hits.slice(0, 3).map((h) => ({ externalId: h.externalId, title: h.title })),
        };
      }
      let downloaded: unknown = null;
      if (payload.importId && payload.downloadAll) {
        const { enqueueHitsForDownload } = await import("@/streamsrc/download-action");
        const all = (await source.importPlaylist?.(String(payload.importId))) ?? [];
        const limit = payload.limit ? Number(payload.limit) : undefined;
        const hits = limit ? all.slice(0, limit) : all;
        downloaded = {
          queued: await enqueueHitsForDownload(hits, { quality: payload.quality as string }),
        };
      }
      // Auto-sync subscribe E2E: bind the favlist to a set + cadence + (optional) auto-download.
      let subscribed: unknown = null;
      if (payload.subscribe && payload.importId) {
        const { subscribeToPlaylist } = await import("@/stores/playlist-auto-sync");
        const { getSession } = await import("@/db/repositories");
        // YouTube has no user-playlist list → fetch the playlist meta for its name/cover.
        const pl =
          playlists.find((p) => p.id === String(payload.importId)) ??
          (await source.getPlaylistMeta?.(String(payload.importId))) ??
          undefined;
        const setId = await subscribeToPlaylist(
          sourceId,
          String(payload.importId),
          pl?.name ?? String(payload.importId),
          {
            frequency: (payload.frequency as never) ?? "app-start",
            autoDownloadNew: payload.autoDownload !== false,
            coverUrl: pl?.coverUrl,
          },
        );
        const set = await getSession(setId);
        const { getTracksByIds } = await import("@/db/repositories");
        const setTracks = set ? await getTracksByIds(set.trackIds) : [];
        subscribed = {
          setId,
          name: set?.name,
          trackCount: set?.trackIds.length ?? 0,
          autoSyncFrequency: set?.autoSyncFrequency,
          autoDownloadNew: set?.autoDownloadNew,
          displayMode: set?.displayMode,
          tracks: setTracks.map((t) => ({
            externalId: t.streamExternalId,
            kind: t.kind,
            hasBlob: Boolean(t.blobId),
            hasCover: Boolean(t.coverBlobId),
            remoteCoverUrl: t.remoteCoverUrl,
          })),
        };
      }
      return { playlists, imported, downloaded, subscribed };
    },
    // Drive/inspect the persistent download queue for E2E (list/enqueue/seedActive/recover/clearAll).
    downloadQueue: async (payload) => {
      const action = String(payload.action ?? "list");
      const repo = await import("@/db/download-job-repo");
      const action$ = await import("@/streamsrc/download-action");
      if (action === "enqueue") {
        const job = await action$.enqueueDownload({
          source: String(payload.source ?? "bili") as StreamSourceId,
          externalId: String(payload.externalId ?? ""),
          title: String(payload.title ?? payload.externalId ?? ""),
          quality: payload.quality as string | undefined,
        });
        return { enqueued: job.id };
      }
      if (action === "seedActive") {
        // Simulate a job left mid-flight by a previous run (for the restart-recovery test).
        const { newId } = await import("@/lib/id");
        const now = Date.now();
        const id = newId("dlj");
        await repo.putDownloadJob({
          id,
          source: String(payload.source ?? "bili") as StreamSourceId,
          externalId: String(payload.externalId ?? ""),
          title: String(payload.title ?? "seed"),
          quality: payload.quality as string | undefined,
          status: "active",
          bytesDone: 0,
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        });
        return { seeded: id };
      }
      if (action === "recover") {
        await action$.recoverDownloadQueue();
        return { recovered: true };
      }
      if (action === "clearAll") {
        const jobs = await repo.listDownloadJobs();
        for (const j of jobs) await repo.deleteDownloadJob(j.id);
        return { cleared: jobs.length };
      }
      const jobs = await repo.listDownloadJobs();
      return {
        jobs: jobs.map((j) => ({
          id: j.id,
          source: j.source,
          externalId: j.externalId,
          status: j.status,
          title: j.title,
          bytesDone: j.bytesDone,
          totalBytes: j.totalBytes,
          attempts: j.attempts,
          lastError: j.lastError,
          trackId: j.trackId,
        })),
      };
    },
    // Backfill an existing streamed track's official cover (no video re-download).
    recoverCover: async (payload) => {
      const trackId = String(payload.trackId ?? "");
      if (!trackId) throw new Error("trackId required");
      const track = await getTrack(trackId);
      if (!track?.streamSourceId) throw new Error("not a streamed track");
      const settings = (await getSettings()) as {
        streamSources?: Record<string, { cookie?: string } | undefined>;
      };
      const source = createStreamSource(track.streamSourceId, {
        http: createStreamHttp(),
        now: () => Date.now(),
        getCookie: (id) => settings.streamSources?.[id]?.cookie,
      });
      if (!source) throw new Error("source unavailable");
      const bridge = resolveDesktopBridge();
      const { resolveMediaBlob } = await import("@/db/media-blob-storage");
      const result = await recoverStreamedTrackCover(trackId, source, {
        fetchBytes: async (url, headers) => {
          const proxied = bridge.mediaProxyUrl ? bridge.mediaProxyUrl(url, headers) : url;
          const resp = await fetch(proxied);
          if (!resp.ok) throw new Error(`fetch ${resp.status}`);
          return resp.blob();
        },
        readMedia: async (blobId) => (await resolveMediaBlob(blobId))?.blob ?? null,
        posterFrame: async (video, durationSec) => {
          const { extractUsefulVideoPosterFrame } = await import("@/lib/video-poster-frame");
          const file = new File([video], "video.mp4", { type: video.type || "video/mp4" });
          const poster = await extractUsefulVideoPosterFrame(file, { durationSec });
          return poster ? { blob: poster.blob, mime: poster.mime } : null;
        },
      });
      const after = await getTrack(trackId);
      return {
        result,
        hasCover: Boolean(after?.coverBlobId),
        remoteCoverUrl: after?.remoteCoverUrl,
      };
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
    // Playback-queue-model E2E (Part A/B). Seeds a cross-set scenario, or plays a track
    // in an explicit set context (the actual fix path) so a driver can assert the queue
    // came from the VIEWED set, not the track's home set.
    playbackContext: async (payload) => {
      const action = String(payload.action ?? "");
      if (action === "seed") {
        const { audio, cover } = await loadExampleTrackAssets();
        const mk = (sessionId: string, title: string) =>
          createUploadedTrack({
            sessionId,
            title,
            kind: "audio",
            blob: audio,
            mime: audio.type || "audio/mpeg",
            durationSec: 30,
            mediaMetadata: fallbackUploadMediaMetadata(audio, title),
            embeddedCover: cover,
          });
        const setX = await createSession({
          name: "E2E-X",
          seedPrompt: "",
          config: { autoExtend: false },
        });
        const setY = await createSession({
          name: "E2E-Y",
          seedPrompt: "",
          config: { autoExtend: false },
        });
        const a = await mk(setX.id, "E2E-A shared"); // home set = X
        const b = await mk(setY.id, "E2E-B");
        const c = await mk(setY.id, "E2E-C");
        const d = await mk(setY.id, "E2E-D");
        await prependTrackIds(setX.id, [a.id]); // X = [A]
        await prependTrackIds(setY.id, [b.id, c.id, d.id]);
        await prependTrackIds(setY.id, [a.id]); // Y = [A, B, C, D]
        return {
          setX: setX.id,
          setY: setY.id,
          trackA: a.id,
          trackB: b.id,
          trackC: c.id,
          trackD: d.id,
        };
      }
      if (action === "playInSet") {
        const setId = String(payload.setId ?? "");
        const trackId = String(payload.trackId ?? "");
        const { getSession, getTracksByIds } = await import("@/db/repositories");
        const { orderedSetTrackIds } = await import("@/player/set-order");
        const session = await getSession(setId);
        const ids = orderedSetTrackIds(session?.trackIds ?? [], session?.trackRanks);
        const tracks = await getTracksByIds(ids);
        const track = tracks.find((t) => t.id === trackId);
        if (!track) throw new Error(`track ${trackId} not in set ${setId}`);
        await usePlayerStore
          .getState()
          .playTrackInContext(track, { source: { kind: "set", setId }, tracks });
        return { played: trackId, setId };
      }
      throw new Error(`unknown playbackContext action: ${action}`);
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

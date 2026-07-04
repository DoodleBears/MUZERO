import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import { getPlayQueue, getSettings, getTrack, setTrackRating } from "@/db/repositories";
import {
  type AudienceRequestIntakeSettings,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  type Track,
} from "@/db/types";
import { type DesktopLiveRequestIntakeControls, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { log } from "@/lib/logger";
import { resolveTrackRating } from "@/lib/track-rating";
import {
  type AudienceRequestRuntime,
  type AudienceRequestRuntimeItem,
  createAudienceRequestRuntime,
} from "./audience-request-runtime";
import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
} from "./audience-request-schema";
import {
  type NormalizedAudienceRequest,
  normalizeAudienceRequest,
} from "./audience-request-schema";
import { findSource, resolveSourceMapping, resolveSources } from "./audience-request-sources";
import { matchIntakeCommand, resolveCommands } from "./intake-command";
import { applyRatingCommand } from "./live-request-annotation";
import { notifyAudienceRequestPlayed, notifyRatingAdded } from "./live-request-notification";
import { applyMapping } from "./request-mapping-presets";
import { DEFAULT_SSN_RELAY_URL } from "./social-stream-relay";

/** Source the SSN relay feeds: prefer an enabled ssn-preset source, else first enabled. */
function pickRelaySourceId(intake: AudienceRequestIntakeSettings): string {
  const sources = resolveSources(intake.sources);
  const ssn = sources.find(
    (source) => source.mappingPreset === "social-stream-ninja" && source.status !== "disabled",
  );
  const enabled = sources.find((source) => source.status !== "disabled");
  return (ssn ?? enabled ?? sources[0]).id;
}

/**
 * The missing "last mile": subscribes the intake transport's `onMessage` and
 * drives each received body through source-resolution → mapping → normalize →
 * runtime, so a live chat request actually searches the library and plays.
 * A module-scope singleton (hard rule #6 — non-reactive engine state stays out
 * of the store).
 *
 * Per-source behaviour: `disabled` is dropped; `testing` captures a sanitized
 * copy for the mapping dialog preview but never acts; `active` maps + routes
 * (with the source's routeMode/playbackAction override). The transport server
 * lifecycle stays with the Settings panel; `onMessage` is multi-subscriber so
 * the panel's debug inbox and this pipeline coexist.
 */

export interface CapturedPayload {
  body: Record<string, unknown>;
  receivedAt: number;
}

export interface LiveRequestControllerDeps {
  db?: MuzeroDB;
  runtime?: AudienceRequestRuntime;
  playNow?: (track: Track) => Promise<void>;
  playNext?: (track: Track) => Promise<void>;
  /** Live play-queue track ids (store-authoritative) for `active-set` scope off-session (GAP2). */
  getActiveQueueTrackIds?: () => string[] | Promise<string[]>;
  /** The track actually playing now (store cursor, not the debounced DB cursor) — Q4. */
  getCurrentTrackId?: () => string | undefined | Promise<string | undefined>;
  /** Notified after a matched track is played / queued (production: a toast). */
  onRequestPlayed?: (input: { track: Track; action: AudienceRequestPlaybackAction }) => void;
  /** Override the rating writer (tests); defaults to the `setTrackRating` repo. */
  setTrackRating?: (trackId: string, raterKey: string, score: number) => Promise<void>;
  /** Notified after a 评分 vote lands (production: a toast). */
  onRated?: (input: { trackId: string; raterKey: string; score: number }) => void;
  now?: () => number;
  /** Inject the intake controls (tests); otherwise resolved from the desktop bridge. */
  controls?: DesktopLiveRequestIntakeControls;
}

export interface LiveRequestController {
  start(): void;
  stop(): void;
  /** Start/stop the transport server to match settings (transport-aware). */
  apply(intake: AudienceRequestIntakeSettings): Promise<void>;
  handlePayload(payload: { sourceId?: string; body: string }): Promise<void>;
  /** Recent sanitized payloads captured for a source while it is in testing mode. */
  getCaptured(sourceId: string): CapturedPayload[];
  /** Recent routed requests (newest first) — observability for tests + dev harness. */
  getItems(): AudienceRequestRuntimeItem[];
  /**
   * Dev/test entry point: route a synthetic query straight through the runtime
   * (search → playback), bypassing the transport + source-resolution layers, with
   * explicit route/action overrides. Mirrors what an incoming chat message does once
   * mapped + normalized — used by the dev control endpoint harness.
   */
  drive(input: {
    query: string;
    routeMode?: AudienceRequestRouteMode;
    playbackAction?: AudienceRequestPlaybackAction;
  }): Promise<AudienceRequestRuntimeItem>;
}

const CAPTURE_LIMIT = 50;

const SENSITIVE_KEYS = new Set([
  "key",
  "api_key",
  "apikey",
  "secret",
  "token",
  "password",
  "authorization",
  "access_token",
  "accesstoken",
  "refresh_token",
  "refreshtoken",
]);

function deepStrip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(deepStrip);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
      out[key] = deepStrip(child);
    }
    return out;
  }
  return value;
}

/** Remove auth-ish fields before storing/displaying a captured payload. */
function stripSensitiveFields(payload: Record<string, unknown>): Record<string, unknown> {
  return deepStrip(payload) as Record<string, unknown>;
}

export function createLiveRequestController(
  deps: LiveRequestControllerDeps = {},
): LiveRequestController {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => Date.now());
  const runtime =
    deps.runtime ??
    createAudienceRequestRuntime({
      db,
      playNow: deps.playNow,
      playNext: deps.playNext,
      onRequestPlayed: deps.onRequestPlayed,
      getActiveQueueTrackIds: deps.getActiveQueueTrackIds,
      getCurrentTrackId: deps.getCurrentTrackId,
    });
  const captures = new Map<string, CapturedPayload[]>();
  let unsubscribe: (() => void) | null = null;

  function capture(sourceId: string, body: Record<string, unknown>): void {
    const ring = captures.get(sourceId) ?? [];
    ring.unshift({ body, receivedAt: now() });
    if (ring.length > CAPTURE_LIMIT) ring.length = CAPTURE_LIMIT;
    captures.set(sourceId, ring);
  }

  // The currently-playing track for annotation intents (评论 / 评分). Prefer the
  // injected store-cursor getter (fresh); fall back to the persisted play queue.
  async function resolveCurrentTrackId(): Promise<string | undefined> {
    const injected = await deps.getCurrentTrackId?.();
    if (injected) return injected;
    const queue = await getPlayQueue(db);
    return queue.currentIndex >= 0 ? queue.entries[queue.currentIndex]?.trackId : undefined;
  }

  async function handlePayload(payload: { sourceId?: string; body: string }): Promise<void> {
    const settings = await getSettings(db);
    const intake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
    if (!intake.enabled) return;

    const source = findSource(resolveSources(intake.sources), payload.sourceId);
    if (!source || source.status === "disabled") return;

    let raw: unknown;
    try {
      raw = JSON.parse(payload.body);
    } catch {
      return; // non-JSON body — ignore
    }
    if (!raw || typeof raw !== "object") return;
    const sanitized = stripSensitiveFields(raw as Record<string, unknown>);

    if (source.status === "testing") {
      // Pre-launch gate: capture the real body for the mapping dialog, never act.
      capture(source.id, sanitized);
      return;
    }

    const mapping = resolveSourceMapping(source);
    const mapped = mapping ? applyMapping(sanitized, mapping) : sanitized;

    const commandPrefixes = source.commandPrefixes ?? intake.commandPrefixes;
    let request: NormalizedAudienceRequest;
    try {
      request = normalizeAudienceRequest(mapped, { commandPrefixes });
    } catch {
      return; // payload had no usable message field
    }

    // Keyword→intent router: the leading keyword decides intent + route. A `request`
    // command (点歌=library-search / AI点歌=ai-dj) drives the runtime with the command's
    // routeMode (which overrides the source/global route); comment/rating write onto the
    // currently-playing track (wired in later phases). No command → fall through to the
    // legacy prefix gate below, so prefix-less config and existing installs keep working.
    const command = matchIntakeCommand(request.rawMessage, resolveCommands(intake));
    if (command) {
      if (command.command.intent === "rating") {
        await applyRatingCommand(command, request, {
          setTrackRating:
            deps.setTrackRating ??
            ((trackId, raterKey, score) => setTrackRating(trackId, raterKey, score, db)),
          getCurrentTrackId: resolveCurrentTrackId,
          onRated: deps.onRated,
        });
        return;
      }
      if (command.command.intent === "comment") {
        // TODO(Phase 3): write a Memory onto the currently-playing track.
        return;
      }
      try {
        await runtime.handle(
          {
            ...request,
            normalizedQuery: command.body,
            matchedCommandPrefix: command.matchedPrefix,
          },
          {
            routeMode: command.command.routeMode ?? source.routeMode ?? intake.routeMode,
            playbackAction:
              command.command.playbackAction ?? source.playbackAction ?? intake.playbackAction,
          },
        );
      } catch (error) {
        log.error("liveRequests", "failed to handle audience request", error);
      }
      return;
    }

    // "Only prefixed messages count as requests": when enabled and prefixes are
    // configured, drop chat that didn't open with one (plain conversation, not a
    // song request). Empty prefixes = nothing to require → everything passes.
    if (
      (intake.requireCommandPrefix ?? true) &&
      commandPrefixes.length > 0 &&
      !request.matchedCommandPrefix
    ) {
      return;
    }

    try {
      await runtime.handle(request, {
        routeMode: source.routeMode ?? intake.routeMode,
        playbackAction: source.playbackAction ?? intake.playbackAction,
      });
    } catch (error) {
      log.error("liveRequests", "failed to handle audience request", error);
    }
  }

  function start(): void {
    if (unsubscribe) return; // idempotent
    const controls = deps.controls ?? resolveDesktopBridge().liveRequestIntake;
    if (!controls) return; // shell without an intake transport
    unsubscribe = controls.onMessage((payload) => {
      void handlePayload(payload);
    });
  }

  function stop(): void {
    unsubscribe?.();
    unsubscribe = null;
  }

  async function apply(intake: AudienceRequestIntakeSettings): Promise<void> {
    const controls = deps.controls ?? resolveDesktopBridge().liveRequestIntake;
    if (!controls) return;
    if (!intake.enabled) {
      await controls.stop();
      return;
    }
    if ((intake.transport ?? "http-webhook") === "ssn-websocket") {
      await controls.start({
        transport: "ssn-websocket",
        relayUrl: intake.ssnRelayUrl ?? DEFAULT_SSN_RELAY_URL,
        sessionId: intake.ssnSessionId ?? "",
        sourceId: pickRelaySourceId(intake),
      });
    } else {
      await controls.start({
        transport: "http-webhook",
        port: intake.port,
        token: intake.authToken ?? "",
      });
    }
  }

  return {
    start,
    stop,
    apply,
    handlePayload,
    getCaptured: (sourceId) => captures.get(sourceId) ?? [],
    getItems: () => runtime.getItems(),
    drive: (input) =>
      runtime.handle(normalizeAudienceRequest({ message: input.query }, { commandPrefixes: [] }), {
        routeMode: input.routeMode,
        playbackAction: input.playbackAction,
      }),
  };
}

let singleton: LiveRequestController | null = null;

function ensureSingleton(): LiveRequestController {
  singleton ??= createLiveRequestController({
    playNow: async (track) => {
      const { usePlayerStore } = await import("@/stores/player-store");
      // Cut-in over the host's current playlist (keep it; don't switch sets).
      await usePlayerStore.getState().playRequestNow(track);
    },
    playNext: async (track) => {
      const { usePlayerStore } = await import("@/stores/player-store");
      // Queue after the playing track (store-cursor-relative) — keep the host's playlist.
      await usePlayerStore.getState().playRequestNext(track);
    },
    // active-set scope off-session (online-playlist / system-playlist / entity / library):
    // the store's live queue IS the "current playlist" (GAP2).
    getActiveQueueTrackIds: async () => {
      const { usePlayerStore } = await import("@/stores/player-store");
      return usePlayerStore.getState().queue.map((t) => t.id);
    },
    // Avoid re-matching the song actually playing — read the store cursor, not the
    // debounced DB cursor that lags a switch by ~900ms (Q4).
    getCurrentTrackId: async () => {
      const { usePlayerStore } = await import("@/stores/player-store");
      const s = usePlayerStore.getState();
      return s.currentIndex >= 0 ? s.queue[s.currentIndex]?.id : undefined;
    },
    // Confirm the request landed with a top-left toast (title + artist · album).
    onRequestPlayed: ({ track, action }) => notifyAudienceRequestPlayed(track, action),
    // Confirm a 评分 vote with the new star + updated crowd average · vote count.
    onRated: async ({ trackId, score }) => {
      const track = await getTrack(trackId, defaultDb);
      if (track) notifyRatingAdded(track, score, resolveTrackRating(track));
    },
  });
  return singleton;
}

/**
 * Mount the intake pipeline once at app start: subscribe the handle pipeline and
 * bring the transport up to match current settings. Idempotent.
 */
export function startLiveRequestIntake(): void {
  const controller = ensureSingleton();
  controller.start();
  void getSettings(defaultDb).then((settings) => {
    const intake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
    void controller.apply(intake);
  });
}

export function stopLiveRequestIntake(): void {
  singleton?.stop();
}

/** Re-apply the transport lifecycle after the Settings panel changes intake config. */
export function applyLiveRequestIntake(intake: AudienceRequestIntakeSettings): Promise<void> {
  return ensureSingleton().apply(intake);
}

/** Sanitized payloads captured for a source in testing mode (mapping-dialog preview). */
export function getCapturedLiveRequests(sourceId: string): CapturedPayload[] {
  return ensureSingleton().getCaptured(sourceId);
}

/** Dev control-endpoint harness: drive a synthetic request through the live singleton. */
export function driveLiveRequest(input: {
  query: string;
  routeMode?: AudienceRequestRouteMode;
  playbackAction?: AudienceRequestPlaybackAction;
}): Promise<AudienceRequestRuntimeItem> {
  return ensureSingleton().drive(input);
}

/** Dev control-endpoint harness: recent routed requests (newest first). */
export function getLiveRequestItems(): AudienceRequestRuntimeItem[] {
  return ensureSingleton().getItems();
}

import { canUseDjChat } from "@/chat/dj-chat-availability";
import { db as defaultDb, type MuzeroDB } from "@/db/muzero-db";
import {
  createSession,
  getPlayQueue,
  getSession,
  getSettings,
  getTrack,
  getTracksByIds,
  listAllLyrics,
  listAllTracks,
  memoryNotesByTrack,
  playQueueAppend,
  playQueueRequestNext,
  prependTrackIds,
  saveSettings,
} from "@/db/repositories";
import {
  type AppSettings,
  type AudienceRequestIntakeSettings,
  DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS,
  type Track,
  type TrackLyrics,
} from "@/db/types";
import i18n from "@/i18n/i18n";
import { newId } from "@/lib/id";
import { DEFAULT_VIDEO_QUALITY, enqueueDownloadAndWait } from "@/streamsrc/download-action";
import type { DownloadStreamedVideoResult } from "@/streamsrc/download-to-library";
import { cacheStreamTrackCover } from "@/streamsrc/playlist-cover-cache";
import type { StreamSearchHit } from "@/streamsrc/provider";
import { resolveEnabledStreamSources } from "@/streamsrc/registry";
import { createStreamHttp } from "@/streamsrc/stream-http";
import {
  createStreamedTrack,
  findLocalDownloadedVideo,
  hitToStreamedInput,
} from "@/streamsrc/streamed-track-repo";
import {
  type AudienceRequestAiDjProgress,
  type AudienceRequestAiDjQueue,
  createAudienceRequestAiDjQueue,
  createDefaultAudienceRequestDjChatAdapter,
} from "./audience-request-ai-dj";
import {
  type AudienceRequestRoutePlan,
  type AudienceRouteSearchSummary,
  planAudienceRequestRoute,
} from "./audience-request-router";
import type {
  AudienceRequestPlaybackAction,
  AudienceRequestRouteMode,
  NormalizedAudienceRequest,
} from "./audience-request-schema";
import {
  type AudienceRequestSearchResult,
  pickAudienceRequestMatch,
} from "./audience-request-search";
import {
  isDuplicateAudienceRequest,
  isRequesterCoolingDown,
  pruneExpiredTimestamps,
} from "./audience-request-security";
import {
  planVideoRequest as planVideoRequestCore,
  type VideoRequestPlan,
  type VideoRequestRejectReason,
} from "./video-request";

export type AudienceRequestStatus =
  | "received"
  | "ignored"
  | "queued"
  | "needs-approval"
  | "completed"
  | "failed";

export interface AudienceRequestRuntimeItem {
  id: string;
  externalId?: string;
  receivedAt: number;
  sourceKind: NormalizedAudienceRequest["sourceKind"];
  platform?: string;
  roomId?: string;
  requesterDisplayName?: string;
  requesterKey?: string;
  requesterRole: NormalizedAudienceRequest["requesterRole"];
  rawMessage: string;
  normalizedQuery: string;
  routeMode: AudienceRequestRouteMode;
  playbackAction: AudienceRequestPlaybackAction;
  status: AudienceRequestStatus;
  matchedTrackId?: string;
  matchedScore?: number;
  secondScore?: number;
  confidence?: "high" | "medium" | "low" | "none";
  chatSessionId?: string;
  error?: string;
  completedAt?: number;
}

export interface OnlineAudienceRequestFallbackInput {
  db: MuzeroDB;
  query: string;
  request: NormalizedAudienceRequest;
  settings: AppSettings;
}

export interface OnlineAudienceRequestFallbackResult {
  trackId: string;
}

export interface AudienceRequestRuntimeDeps {
  db?: MuzeroDB;
  now?: () => number;
  getCurrentTrackId?: () => string | undefined | Promise<string | undefined>;
  getActiveSessionId?: () => string | undefined | Promise<string | undefined>;
  /**
   * Track ids of the LIVE play queue (the "current playlist" as the user sees it).
   * Used by `active-set` scope when the context has no DjSession — online-playlist /
   * system-playlist / entity / library all play without a `contextSetId`, so the only
   * notion of "this playlist" is the play queue itself (GAP2). Falls back to the
   * persisted `getPlayQueue` entries when not injected (e.g. unit tests).
   */
  getActiveQueueTrackIds?: () => string[] | Promise<string[]>;
  hasConfiguredOnlineSources?: (settings: AppSettings) => boolean;
  onlineFallback?: (
    input: OnlineAudienceRequestFallbackInput,
  ) => Promise<OnlineAudienceRequestFallbackResult | null>;
  canUseAiDj?: (settings: AppSettings) => boolean;
  aiDjQueue?: AudienceRequestAiDjQueue;
  playNow?: (track: Track) => Promise<void>;
  /** Player-aware "play next" — anchors the FIFO insert to the live (store) cursor.
   *  Falls back to a DB-cursor-relative insert when not injected (e.g. unit tests). */
  playNext?: (track: Track) => Promise<void>;
  /**
   * Fired after a request's matched track is successfully played / queued
   * (any of play-now / play-next / append-queue). The production controller
   * uses it to surface a "request landed" notification; left unset in unit
   * tests so the search/route engine carries no UI dependency.
   */
  onRequestPlayed?: (input: { track: Track; action: AudienceRequestPlaybackAction }) => void;
  planVideoRequest?: (input: {
    body: string;
    settings: AppSettings;
    intake: AudienceRequestIntakeSettings;
  }) => Promise<VideoRequestPlan>;
  downloadVideoHit?: (
    hit: StreamSearchHit,
    opts: { quality?: string; sessionId: string },
  ) => Promise<DownloadStreamedVideoResult>;
  resolveVideoSetId?: (settings: AppSettings) => Promise<string>;
  onVideoRequestRejected?: (input: {
    reason: VideoRequestRejectReason | "download-failed";
    durationSec?: number;
    maxSec?: number;
    message?: string;
  }) => void;
}

/** Per-call routing overrides — a multi-source intake sets these from the source config. */
export interface AudienceRequestHandleOverride {
  routeMode?: AudienceRequestRouteMode;
  playbackAction?: AudienceRequestPlaybackAction;
}

export interface AudienceRequestRuntime {
  handle(
    request: NormalizedAudienceRequest,
    override?: AudienceRequestHandleOverride,
  ): Promise<AudienceRequestRuntimeItem>;
  handleVideoRequest(
    request: NormalizedAudienceRequest,
    body: string,
    override?: Pick<AudienceRequestHandleOverride, "playbackAction">,
  ): Promise<AudienceRequestRuntimeItem>;
  approve(id: string, action?: AudienceRequestPlaybackAction): Promise<AudienceRequestRuntimeItem>;
  reject(id: string): AudienceRequestRuntimeItem | undefined;
  getItems(): AudienceRequestRuntimeItem[];
}

export interface ExecuteVideoRequestResult {
  status: Extract<AudienceRequestStatus, "completed" | "failed" | "ignored">;
  matchedTrackId?: string;
  error?: string;
}

export interface ExecuteVideoRequestDeps {
  action: AudienceRequestPlaybackAction;
  quality?: string;
  resolveVideoSetId: () => Promise<string>;
  downloadHit: (
    hit: StreamSearchHit,
    opts: { quality?: string; sessionId: string },
  ) => Promise<DownloadStreamedVideoResult>;
  getTrack: (trackId: string) => Promise<Track | undefined>;
  executePlayback: (action: AudienceRequestPlaybackAction, track: Track) => Promise<void>;
  notifyRejected: (input: {
    reason: VideoRequestRejectReason | "download-failed";
    durationSec?: number;
    maxSec?: number;
    message?: string;
  }) => void;
}

export async function executeVideoRequest(
  plan: VideoRequestPlan,
  deps: ExecuteVideoRequestDeps,
): Promise<ExecuteVideoRequestResult> {
  if (plan.kind === "rejected") {
    deps.notifyRejected({
      reason: plan.reason,
      durationSec: plan.durationSec,
      maxSec: plan.maxSec,
    });
    return { status: "ignored", error: plan.reason };
  }
  if (plan.kind === "play-local") {
    await deps.executePlayback(deps.action, plan.track);
    return { status: "completed", matchedTrackId: plan.track.id };
  }

  const sessionId = await deps.resolveVideoSetId();
  const downloaded = await deps.downloadHit(plan.hit, { quality: deps.quality, sessionId });
  if (downloaded.kind === "downloaded") {
    const track = await deps.getTrack(downloaded.trackId);
    if (!track) return { status: "failed", error: "track-not-found" };
    await deps.executePlayback(deps.action, track);
    return { status: "completed", matchedTrackId: track.id };
  }

  const message =
    downloaded.kind === "requires-login"
      ? "requires-login"
      : downloaded.kind === "no-permission"
        ? downloaded.reason
        : downloaded.message;
  deps.notifyRejected({ reason: "download-failed", message });
  return { status: "failed", error: message };
}

export function createAudienceRequestRuntime(
  deps: AudienceRequestRuntimeDeps = {},
): AudienceRequestRuntime {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => Date.now());
  const items: AudienceRequestRuntimeItem[] = [];
  const seenExternalIds = new Map<string, number>();
  const lastAcceptedByRequester = new Map<string, number>();
  const aiDjQueue =
    deps.aiDjQueue ??
    createAudienceRequestAiDjQueue({
      adapter: createDefaultAudienceRequestDjChatAdapter(db),
    });
  let recentAcceptedAt: number[] = [];

  async function handle(
    request: NormalizedAudienceRequest,
    override: AudienceRequestHandleOverride = {},
  ): Promise<AudienceRequestRuntimeItem> {
    const settings = await getSettings(db);
    const baseIntake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
    const intake: AudienceRequestIntakeSettings = {
      ...baseIntake,
      routeMode: override.routeMode ?? baseIntake.routeMode,
      playbackAction: override.playbackAction ?? baseIntake.playbackAction,
    };
    const receivedAt = now();
    const item = createItem(request, intake, receivedAt);
    remember(item);

    if (!request.normalizedQuery.trim()) {
      return finish(item, { status: "ignored", confidence: "none" });
    }
    if (
      isDuplicateAudienceRequest({
        externalId: request.externalId,
        now: receivedAt,
        seenExternalIds,
        dedupeWindowMs: intake.dedupeWindowSec * 1000,
      })
    ) {
      return finish(item, { status: "ignored", confidence: "none", error: "duplicate" });
    }
    if (
      isRequesterCoolingDown({
        requesterKey: request.requesterKey,
        now: receivedAt,
        lastAcceptedByRequester,
        cooldownMs: intake.requesterCooldownSec * 1000,
      })
    ) {
      return finish(item, { status: "ignored", confidence: "none", error: "cooldown" });
    }
    recentAcceptedAt = recentAcceptedAt.filter((at) => receivedAt - at < 60_000);
    // Same sweep spot as the rate window: expire dedupe/cooldown keys past their
    // decision windows so a multi-day live stream can't grow the maps unbounded
    // (memory-leak PRD 20260705 L-2). Decisions are unchanged — the checks above
    // only ever look one window back.
    pruneExpiredTimestamps(seenExternalIds, receivedAt, intake.dedupeWindowSec * 1000);
    pruneExpiredTimestamps(lastAcceptedByRequester, receivedAt, intake.requesterCooldownSec * 1000);
    if (recentAcceptedAt.length >= intake.maxRequestsPerMinute) {
      return finish(item, { status: "ignored", confidence: "none", error: "rate-limited" });
    }

    if (request.externalId) seenExternalIds.set(request.externalId, receivedAt);
    if (request.requesterKey) lastAcceptedByRequester.set(request.requesterKey, receivedAt);
    recentAcceptedAt.push(receivedAt);

    try {
      const search = await searchLocal(request, intake);
      applySearchMetadata(item, search);
      const plan = planAudienceRequestRoute({
        routeMode: intake.routeMode,
        playbackAction: intake.playbackAction,
        search: toRouteSearchSummary(search),
        onlineFallbackOnLowConfidence: intake.onlineFallbackOnLowConfidence,
        hasConfiguredOnlineSources: hasOnlineSources(settings),
        canUseAiDj: deps.canUseAiDj?.(settings) ?? canUseDjChat(settings),
        requireApprovalForPlayNow: intake.requireApprovalForPlayNow,
      });
      return executePlan({ intake, item, plan, request, settings });
    } catch (error) {
      return finish(item, {
        status: "failed",
        confidence: item.confidence,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function handleVideoRequest(
    request: NormalizedAudienceRequest,
    body: string,
    override: Pick<AudienceRequestHandleOverride, "playbackAction"> = {},
  ): Promise<AudienceRequestRuntimeItem> {
    const settings = await getSettings(db);
    const baseIntake = settings.audienceRequestIntake ?? DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS;
    const intake: AudienceRequestIntakeSettings = {
      ...baseIntake,
      playbackAction: override.playbackAction ?? baseIntake.playbackAction,
    };
    const receivedAt = now();
    const item = createItem({ ...request, normalizedQuery: body }, intake, receivedAt);
    remember(item);

    if (!body.trim()) {
      return finish(item, { status: "ignored", confidence: "none", error: "not-a-video-ref" });
    }
    if (
      isDuplicateAudienceRequest({
        externalId: request.externalId,
        now: receivedAt,
        seenExternalIds,
        dedupeWindowMs: intake.dedupeWindowSec * 1000,
      })
    ) {
      return finish(item, { status: "ignored", confidence: "none", error: "duplicate" });
    }
    if (
      isRequesterCoolingDown({
        requesterKey: request.requesterKey,
        now: receivedAt,
        lastAcceptedByRequester,
        cooldownMs: intake.requesterCooldownSec * 1000,
      })
    ) {
      return finish(item, { status: "ignored", confidence: "none", error: "cooldown" });
    }
    recentAcceptedAt = recentAcceptedAt.filter((at) => receivedAt - at < 60_000);
    pruneExpiredTimestamps(seenExternalIds, receivedAt, intake.dedupeWindowSec * 1000);
    pruneExpiredTimestamps(lastAcceptedByRequester, receivedAt, intake.requesterCooldownSec * 1000);
    if (recentAcceptedAt.length >= intake.maxRequestsPerMinute) {
      return finish(item, { status: "ignored", confidence: "none", error: "rate-limited" });
    }

    if (request.externalId) seenExternalIds.set(request.externalId, receivedAt);
    if (request.requesterKey) lastAcceptedByRequester.set(request.requesterKey, receivedAt);
    recentAcceptedAt.push(receivedAt);

    try {
      const plan =
        (await deps.planVideoRequest?.({ body, settings, intake })) ??
        (await defaultPlanVideoRequest(body, settings, intake));
      const result = await executeVideoRequest(plan, {
        action: intake.playbackAction,
        downloadHit:
          deps.downloadVideoHit ??
          ((hit, opts) =>
            enqueueDownloadAndWait({
              coverUrl: hit.coverUrl,
              externalId: hit.externalId,
              quality: opts.quality,
              sessionId: opts.sessionId,
              source: hit.source,
              title: hit.title,
            })),
        executePlayback,
        getTrack: (trackId) => getTrack(trackId, db),
        notifyRejected: (input) => deps.onVideoRequestRejected?.(input),
        quality: settings.defaultVideoQuality ?? DEFAULT_VIDEO_QUALITY,
        resolveVideoSetId: () =>
          deps.resolveVideoSetId?.(settings) ?? resolveLiveRequestVideoSetId(db, settings),
      });
      return finish(item, {
        status: result.status,
        matchedTrackId: result.matchedTrackId,
        error: result.error,
      });
    } catch (error) {
      return finish(item, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function approve(
    id: string,
    action?: AudienceRequestPlaybackAction,
  ): Promise<AudienceRequestRuntimeItem> {
    const item = items.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Audience request not found: ${id}`);
    if (!item.matchedTrackId) return finish(item, { status: "ignored", error: "no-match" });
    const track = await getTrack(item.matchedTrackId, db);
    if (!track) return finish(item, { status: "failed", error: "track-not-found" });
    const playbackAction = action ?? item.playbackAction;
    await executePlayback(playbackAction, track);
    item.playbackAction = playbackAction;
    return finish(item, { status: "completed", matchedTrackId: track.id });
  }

  function reject(id: string): AudienceRequestRuntimeItem | undefined {
    const item = items.find((candidate) => candidate.id === id);
    return item ? finish(item, { status: "ignored", error: "rejected" }) : undefined;
  }

  async function searchLocal(
    request: NormalizedAudienceRequest,
    intake: AudienceRequestIntakeSettings,
  ): Promise<AudienceRequestSearchResult> {
    const tracks = await tracksForScope(intake.searchScope);
    const trackIds = tracks.map((track) => track.id);
    const notes = trackIds.length > 0 ? await memoryNotesByTrack(trackIds, db) : undefined;
    const lyrics = intake.includeLyrics ? lyricsByTrackId(await listAllLyrics(db)) : undefined;
    return pickAudienceRequestMatch({
      tracks,
      query: request.normalizedQuery,
      matchFields: intake.routeMode === "library-search" ? "song-title" : "broad",
      memoryNotesByTrackId: notes,
      lyricsByTrackId: lyrics,
      threshold: intake.confidenceThreshold,
      margin: intake.scoreMarginThreshold,
      avoidCurrentTrackId: await currentTrackId(),
      onlineFallbackOnLowConfidence: intake.onlineFallbackOnLowConfidence,
      hasConfiguredOnlineSources: hasOnlineSources(await getSettings(db)),
    });
  }

  async function tracksForScope(scope: AudienceRequestIntakeSettings["searchScope"]) {
    if (scope === "all-library") return listAllTracks(db);
    const activeSessionId = await resolveActiveSessionId();
    if (activeSessionId) {
      const session = await getSession(activeSessionId, db);
      if (session) return getTracksByIds(session.trackIds, db);
    }
    // No DjSession context (online-playlist / system-playlist / entity / library) — the
    // "current playlist" is the live play queue itself. Searching it keeps `active-set`
    // working off-set instead of silently matching an empty set (GAP2).
    return getTracksByIds(await resolveActiveQueueTrackIds(), db);
  }

  async function resolveActiveQueueTrackIds(): Promise<string[]> {
    const injected = await deps.getActiveQueueTrackIds?.();
    if (injected) return injected;
    return (await getPlayQueue(db)).entries.map((entry) => entry.trackId);
  }

  async function resolveActiveSessionId(): Promise<string | undefined> {
    const injected = await deps.getActiveSessionId?.();
    if (injected) return injected;
    return (await getPlayQueue(db)).contextSetId;
  }

  async function currentTrackId(): Promise<string | undefined> {
    const injected = await deps.getCurrentTrackId?.();
    if (injected) return injected;
    const queue = await getPlayQueue(db);
    return queue.currentIndex >= 0 ? queue.entries[queue.currentIndex]?.trackId : undefined;
  }

  function hasOnlineSources(settings: AppSettings): boolean {
    return (
      deps.hasConfiguredOnlineSources?.(settings) ??
      Object.values(settings.streamSources ?? {}).some((source) =>
        Boolean(source?.enabled || source?.cookie || source?.accessToken),
      )
    );
  }

  async function executePlan(input: {
    intake: AudienceRequestIntakeSettings;
    item: AudienceRequestRuntimeItem;
    plan: AudienceRequestRoutePlan;
    request: NormalizedAudienceRequest;
    settings: AppSettings;
  }): Promise<AudienceRequestRuntimeItem> {
    const { intake, item, plan, request, settings } = input;
    if (plan.kind === "playback") {
      const track = await getRequiredTrack(plan.trackId);
      await executePlayback(plan.action, track);
      return finish(item, { status: "completed", matchedTrackId: track.id });
    }
    if (plan.kind === "needs-approval") {
      return finish(item, {
        status: "needs-approval",
        matchedTrackId: plan.trackId,
        error: plan.reason,
      });
    }
    if (plan.kind === "online-search") {
      const online = await (deps.onlineFallback ?? defaultOnlineFallback)({
        db,
        query: request.normalizedQuery,
        request,
        settings,
      });
      if (!online) {
        return finish(item, {
          status: "needs-approval",
          confidence: "low",
          error: "online-fallback-empty",
        });
      }
      const track = await getRequiredTrack(online.trackId);
      const fallbackPlan = planPlaybackForMatch(intake, track.id);
      if (fallbackPlan.kind === "playback") {
        await executePlayback(fallbackPlan.action, track);
        return finish(item, {
          status: "completed",
          matchedTrackId: track.id,
          confidence: "medium",
        });
      }
      return finish(item, {
        status: "needs-approval",
        matchedTrackId: track.id,
        confidence: "medium",
        error: fallbackPlan.reason,
      });
    }
    if (plan.kind === "ai-dj") {
      return enqueueAiDj({ intake, item, request });
    }
    return finish(item, { status: "ignored", error: plan.reason });
  }

  function enqueueAiDj(input: {
    intake: AudienceRequestIntakeSettings;
    item: AudienceRequestRuntimeItem;
    request: NormalizedAudienceRequest;
  }): AudienceRequestRuntimeItem {
    const { intake, item, request } = input;
    item.status = "queued";
    try {
      const pending = aiDjQueue.enqueue({
        onProgress: (progress) => applyAiDjProgress(item, progress),
        playbackAction: intake.playbackAction,
        request,
        routeMode: intake.routeMode,
      });
      void pending
        .then((result) => {
          finish(item, {
            chatSessionId: result.chatSessionId,
            status: "completed",
          });
        })
        .catch((error: unknown) => {
          finish(item, {
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        });
    } catch (error) {
      return finish(item, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return item;
  }

  function applyAiDjProgress(
    item: AudienceRequestRuntimeItem,
    progress: AudienceRequestAiDjProgress,
  ): void {
    if (progress.chatSessionId) item.chatSessionId = progress.chatSessionId;
    if (progress.status === "queued") {
      item.status = "queued";
      return;
    }
    if (progress.status === "completed") {
      finish(item, { chatSessionId: progress.chatSessionId, status: "completed" });
      return;
    }
    finish(item, {
      chatSessionId: progress.chatSessionId,
      status: "failed",
      error: progress.error,
    });
  }

  async function executePlayback(action: AudienceRequestPlaybackAction, track: Track) {
    if (action === "append-queue") {
      await playQueueAppend([track.id], db);
    } else if (action === "play-next") {
      if (deps.playNext) await deps.playNext(track);
      else await playQueueRequestNext([track.id], db);
    } else if (action === "play-now") {
      if (!deps.playNow) throw new Error("play-now requires a player dependency");
      await deps.playNow(track);
    }
    // Only reached once the action above resolved (a throwing play-now skips this).
    deps.onRequestPlayed?.({ track, action });
  }

  async function getRequiredTrack(trackId: string): Promise<Track> {
    const track = await getTrack(trackId, db);
    if (!track) throw new Error(`Track not found: ${trackId}`);
    return track;
  }

  async function defaultOnlineFallback(
    input: OnlineAudienceRequestFallbackInput,
  ): Promise<OnlineAudienceRequestFallbackResult | null> {
    const streamDeps = {
      http: createStreamHttp(),
      now,
      getCookie: (id: keyof NonNullable<AppSettings["streamSources"]>) =>
        input.settings.streamSources?.[id]?.cookie,
    };
    const sources = resolveEnabledStreamSources(input.settings, streamDeps);
    if (sources.length === 0) return null;
    const results = await Promise.all(
      sources.map((source) => source.search(input.query, { limit: 1 }).catch(() => [])),
    );
    const hit = results.flat()[0];
    if (!hit) return null;
    // Q3: online matches ALWAYS land in the dedicated 点歌/online set — never the
    // currently-active set — so the audience-request library has one stable home.
    const sessionId = await resolveLiveRequestOnlineSetId(db, input.settings);
    const track = await createStreamedTrack(hitToStreamedInput(sessionId, hit), db);
    await prependTrackIds(sessionId, [track.id], db);
    // Pull the cover into a local blob so the 点歌歌单 renders art offline — best-effort,
    // fire-and-forget, mirroring the store's playStreamedHit (only on shells with muzfetch).
    if (track.remoteCoverUrl && !track.coverBlobId) {
      void cacheStreamTrackCover({ trackId: track.id, coverUrl: track.remoteCoverUrl });
    }
    return { trackId: track.id };
  }

  async function defaultPlanVideoRequest(
    body: string,
    settings: AppSettings,
    intake: AudienceRequestIntakeSettings,
  ): Promise<VideoRequestPlan> {
    const streamDeps = {
      http: createStreamHttp(),
      now,
      getCookie: (id: keyof NonNullable<AppSettings["streamSources"]>) =>
        settings.streamSources?.[id]?.cookie,
    };
    const sources = resolveEnabledStreamSources(settings, streamDeps);
    const byId = new Map(sources.map((source) => [source.id, source]));
    return planVideoRequestCore(body, {
      maxDurationSec:
        intake.maxVideoRequestDurationSec ??
        DEFAULT_AUDIENCE_REQUEST_INTAKE_SETTINGS.maxVideoRequestDurationSec,
      fetchFirstPartExternalId: async (externalId) => {
        const parts = await byId.get("bili")?.listParts?.(externalId);
        return parts?.[0]?.externalId;
      },
      fetchHit: async (ref) => {
        const hits = await byId.get(ref.source)?.getTracksByIds?.([ref.id]);
        return hits?.[0];
      },
      findLocal: (source, externalId) => findLocalDownloadedVideo(source, externalId, db),
    });
  }

  return {
    handle,
    handleVideoRequest,
    approve,
    reject,
    getItems: () => [...items],
  };

  function remember(item: AudienceRequestRuntimeItem) {
    items.unshift(item);
    if (items.length > 50) items.length = 50;
  }

  function finish(
    item: AudienceRequestRuntimeItem,
    patch: Partial<AudienceRequestRuntimeItem>,
  ): AudienceRequestRuntimeItem {
    Object.assign(item, patch);
    if (item.status === "completed" || item.status === "failed" || item.status === "ignored") {
      item.completedAt = now();
    }
    return item;
  }
}

/**
 * The stable home set for online-matched audience requests (Q3): the dedicated
 * 点歌/online set, NOT whatever set happens to be playing. Returns the persisted
 * `streamOnlineSetId` when it still resolves to a real session, otherwise creates one
 * and persists it. Module-level + db-injected so it is unit-testable in isolation.
 */
export async function resolveLiveRequestOnlineSetId(
  db: MuzeroDB,
  settings: AppSettings,
): Promise<string> {
  if (settings.streamOnlineSetId && (await getSession(settings.streamOnlineSetId, db))) {
    return settings.streamOnlineSetId;
  }
  const session = await createSession(
    { name: i18n.t("globalSearch.onlineSetName"), seedPrompt: "", config: { autoExtend: false } },
    db,
  );
  await saveSettings({ streamOnlineSetId: session.id }, db);
  return session.id;
}

/**
 * The stable home set for videos downloaded by live requests. Reuses the existing
 * Downloads set contract so 点视频, manual video downloads, and playlist video imports
 * share one local bucket.
 */
export async function resolveLiveRequestVideoSetId(
  db: MuzeroDB,
  settings: AppSettings,
): Promise<string> {
  if (settings.streamDownloadsSetId && (await getSession(settings.streamDownloadsSetId, db))) {
    return settings.streamDownloadsSetId;
  }
  const session = await createSession(
    {
      name: i18n.t("download.setName"),
      seedPrompt: "",
      config: { autoExtend: false },
      displayMode: "video",
    },
    db,
  );
  await saveSettings({ streamDownloadsSetId: session.id }, db);
  return session.id;
}

function createItem(
  request: NormalizedAudienceRequest,
  intake: AudienceRequestIntakeSettings,
  receivedAt: number,
): AudienceRequestRuntimeItem {
  return {
    id: newId("arq"),
    externalId: request.externalId,
    receivedAt,
    sourceKind: request.sourceKind,
    platform: request.platform,
    roomId: request.roomId,
    requesterDisplayName: request.requesterDisplayName,
    requesterKey: request.requesterKey,
    requesterRole: request.requesterRole,
    rawMessage: request.rawMessage,
    normalizedQuery: request.normalizedQuery,
    routeMode: intake.routeMode,
    playbackAction: intake.playbackAction,
    status: "received",
  };
}

function toRouteSearchSummary(search: AudienceRequestSearchResult): AudienceRouteSearchSummary {
  if (search.kind === "match") {
    return {
      kind: "match",
      trackId: search.best.track.id,
      onlineFallbackRecommended: false,
    };
  }
  if (search.kind === "low-confidence") {
    return {
      kind: "low-confidence",
      trackId: search.best?.track.id,
      onlineFallbackRecommended: search.onlineFallbackRecommended,
    };
  }
  return {
    kind: "no-match",
    onlineFallbackRecommended: search.onlineFallbackRecommended,
  };
}

function applySearchMetadata(
  item: AudienceRequestRuntimeItem,
  search: AudienceRequestSearchResult,
) {
  if (search.kind === "no-match") {
    item.confidence = "none";
    return;
  }
  item.matchedTrackId = search.best?.track.id;
  item.matchedScore = search.best?.score;
  item.secondScore = search.candidates[1]?.score;
  item.confidence = search.kind === "match" ? "high" : "low";
}

function planPlaybackForMatch(
  intake: AudienceRequestIntakeSettings,
  trackId: string,
): Extract<AudienceRequestRoutePlan, { kind: "playback" | "needs-approval" }> {
  if (intake.playbackAction === "manual-review") {
    return { kind: "needs-approval", reason: "manual-review", trackId };
  }
  if (intake.playbackAction === "play-now" && intake.requireApprovalForPlayNow) {
    return { kind: "needs-approval", reason: "play-now-requires-approval", trackId };
  }
  return { kind: "playback", action: intake.playbackAction, trackId };
}

function lyricsByTrackId(rows: TrackLyrics[]) {
  return new Map(rows.map((row) => [row.trackId, row]));
}

import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";
import { db } from "@/db/muzero-db";
import {
  createReferencedUploadedTrack,
  createSession,
  createUploadedTrack,
  deleteSession as deleteSessionRepo,
  getPlayQueue,
  getSession,
  getSettings,
  getTrack,
  getTrackBlob,
  getTrackCover,
  getTracksByIds,
  insertTrackIdsAfter,
  knownSourcePaths,
  playQueueAppend,
  playQueueInsertAt,
  playQueuePlayNext,
  playQueueRequestNextAt,
  playQueueSet,
  playQueueSetContext,
  playQueueSetIndex,
  prependTrackIds,
  saveSettings,
  setSessionDisplayMode,
  setTrackCover,
  upsertImportFolder,
} from "@/db/repositories";
import type { ImportFolder, SetDisplayMode, StreamSourceId, Track } from "@/db/types";
import { createAiDjBrain } from "@/dj/dj-brain-ai";
import { createDjEngine, type DjEngine } from "@/dj/dj-engine";
import i18n from "@/i18n/i18n";
import { hasFolderAccess, resolveDesktopBridge } from "@/lib/desktop/bridge";
import { createTraceId, type DiagnosticContext, sanitizeUrlForTrace } from "@/lib/diagnostics";
import {
  basename,
  createFolderFs,
  type FolderFs,
  grantFolderAccess,
  mimeFromExtension,
  pickFolder,
  type ScannedFile,
  scanFolderForMedia,
  selectNewFiles,
} from "@/lib/folder-import";
import { yieldForImportBackpressure } from "@/lib/import-backpressure";
import { copyBlobWithProgress, type ImportProgress } from "@/lib/import-progress";
import { createDiagnosticLogger, log } from "@/lib/logger";
import { fallbackUploadMediaMetadata, parseUploadedMediaMetadata } from "@/lib/media-metadata";
import { isUnsupportedMediaError, probeMediaFile } from "@/lib/media-probe";
import {
  canSetPlatformMediaSessionMetadata,
  setPlatformMediaSessionActionHandlers,
  setPlatformMediaSessionMetadata,
  setPlatformMediaSessionPlaybackState,
} from "@/lib/media-session";
import { isNcmFile } from "@/lib/ncm-decode";
import { notePerfWork } from "@/lib/perf-counters";
import { getAppFetch } from "@/lib/platform";
import type { SystemPlaylistId } from "@/lib/system-playlists";
import { describeTrackCoverSource, describeTrackMediaSource } from "@/lib/track-source";
import { runAutoFetchLyrics } from "@/lyrics/auto-fetch";
import { resolveLyricsProviderForTrack } from "@/lyrics/registry";
import { resolveMusicGenProvider } from "@/musicgen/registry";
import { MediaEngine } from "@/player/media-engine";
import { reconcileCurrentIndex, unconsumedTrackIds } from "@/player/play-queue";
import {
  getCachedRemotePlayback,
  playbackCacheLimitBytes,
  putRemotePlaybackCache,
} from "@/player/playback-cache";
import {
  isCloudMetadataOnlyStreamTrack,
  recordStreamSkipFailure,
  streamResolveFailureNotificationLevel,
} from "@/player/playback-failure";
import {
  buildShuffleOrder,
  clampIndex,
  manualNextIndex,
  manualStepIndex,
  prevIndex,
  type RepeatMode,
  shuffleManualNext,
  shufflePrev,
  upcomingManualIndices,
  windowManualIndices,
} from "@/player/queue";
import { describeTrackSwitch } from "@/player/switch-trace";
import {
  beginFolderImport,
  endFolderImport,
  setFolderImportProgress,
} from "@/stores/folder-import-store";
import { notify } from "@/stores/notification-store";
import { setSetBulkDownloading, setStreamDownloading } from "@/stores/stream-cache-store";
import { runStreamCache } from "@/streamsrc/cache-stream";
import {
  cacheStreamPlaylistCover,
  cacheStreamPlaylistTrackCovers,
  cacheStreamTrackCover,
} from "@/streamsrc/playlist-cover-cache";
import type { StreamPlaylist, StreamSearchHit } from "@/streamsrc/provider";
import { createStreamSource } from "@/streamsrc/registry";
import { resolveStreamedTrackMedia, type StreamPlaybackResult } from "@/streamsrc/resolve-playback";
import {
  isStreamedTrack,
  isTrackCacheableToDevice,
  type PlaybackSourceKind,
  playbackSourceKind,
} from "@/streamsrc/source-detect";
import { createStreamHttp } from "@/streamsrc/stream-http";
import {
  type AddHitsResult,
  addHitsToSet,
  cacheStreamedTrackBlob,
  createStreamedTrack,
  hitToStreamedInput,
} from "@/streamsrc/streamed-track-repo";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import { getOrCreateLocalDevice } from "@/sync/device-repo";
import {
  createPlaybackListenTracker,
  type PlaybackListenFlush,
} from "@/sync/playback-listen-session";
import { recordPlaybackListen } from "@/sync/playback-stats";
import { cacheRemoteTrackMedia } from "@/sync/r2-cache";
import { canWritePresenceToDrive } from "@/sync/r2-presence";
import {
  createR2PresenceCoordinator,
  type R2PresenceCoordinator,
} from "@/sync/r2-presence-coordinator";
import { writeR2Presence } from "@/sync/r2-presence-sync";
import { decodeNcmViaWorker, ingestViaWorker } from "@/workers/heavy-client";
import type { DecodedNcmMedia } from "@/workers/ingest-core";

const IMPORT_VISIBILITY_FLUSH_SIZE = 25;
const IMPORT_PROGRESS_CLEAR_MS = 1800;
const LOCAL_BLOB_PLAYBACK_SETTLE_MS = 180;
const MEDIA_SESSION_METADATA_SETTLE_MS = 650;
const MEDIA_SOURCE_RELOAD_BISECT_MODE:
  | "off"
  | "skip"
  | "read"
  | "attach-no-play"
  | "attach-and-play"
  | "attach-play-media-session"
  | "attach-play-media-session-settled" = "off";
const DEFAULT_PLAYER_VOLUME = 0.9;

export type QueueSource =
  | { kind: "set"; setId: string }
  | { kind: "system-playlist"; id: SystemPlaylistId }
  | { kind: "online-playlist"; playlist: StreamPlaylist };

interface PlayerState {
  activeSessionId: string | null;
  /** Non-persisted "playing from" label source. System playlists are not DjSession rows. */
  queueSource?: QueueSource;
  /** Reactive snapshot of the active set's tracks, in queue order. */
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  wantPlay: boolean;
  playbackLoading: PlaybackLoadingState | null;
  positionSec: number;
  durationSec: number;
  volume: number;
  repeat: RepeatMode;
  /** Play tracks in a shuffled order. */
  shuffle: boolean;
  /** Stage rendering for the active set (video-first → cover → title). */
  displayMode: SetDisplayMode;
  /** Whether the active set lets the DJ auto-generate more tracks. */
  djEnabled: boolean;
  // DJ status flags for the console UI.
  isDrafting: boolean;
  isGenerating: boolean;
  isUploading: boolean;
  importProgress: ImportProgress | null;
  djError: string | null;

  init: () => void;
  setActiveSession: (sessionId: string) => Promise<void>;
  playSystemPlaylist: (playlistId: SystemPlaylistId, tracks: Track[]) => Promise<void>;
  rebuildEngine: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  playIndex: (index: number) => Promise<void>;
  /** Load + show a track WITHOUT playing it (boot resume) — no gesture-blocked
   * play() / AudioContext. Playback waits for a real user gesture. */
  cueIndex: (index: number) => Promise<void>;
  /** Play a specific track, switching sets if needed (search/library result). */
  playTrack: (track: Track) => Promise<void>;
  /** Insert a specific track right after the current play position. */
  playNextTrack: (track: Track) => Promise<void>;
  /**
   * Cut-in: insert a track right after the current one and skip to it, keeping
   * the rest of the queue (does NOT switch to the track's set, unlike playTrack).
   * Used by live "play now" requests.
   */
  playRequestNow: (track: Track) => Promise<void>;
  /**
   * Queue a live "play next" request into the FIFO request block right after the track
   * that's actually playing (store cursor), WITHOUT switching what's playing. Anchored to
   * the store cursor rather than the persisted DB cursor so the request never lands behind
   * the playing slot during the post-switch cursor-persist window.
   */
  playRequestNext: (track: Track) => Promise<void>;
  /** Play a song from an online source (global search): import it into the online set, then play. */
  playStreamedHit: (hit: StreamSearchHit) => Promise<void>;
  /** Play a batch of online hits in order (Discover "play all"): queue the tail into the
   *  online set, then play the head via the same single-play path. */
  playStreamedHits: (hits: StreamSearchHit[]) => Promise<void>;
  /**
   * Import a source playlist into a NEW set of streamed tracks (tagged with the
   * playlist ref for later incremental re-sync); returns how many were added.
   * `opts.download` then caches every track to a local blob in the background.
   */
  importStreamedPlaylist: (
    sourceId: StreamSourceId,
    playlistId: string,
    name: string,
    opts?: {
      coverUrl?: string;
      download?: boolean;
      onProgress?: (done: number, total: number) => void;
    },
  ) => Promise<number>;
  /**
   * Add a source playlist's tracks into an EXISTING set, auto-deduping (incremental
   * re-sync or "add to a set I choose"); returns {added, skipped}. `opts.download`
   * then caches the set's uncached streamed tracks to local blobs in the background.
   */
  addStreamedPlaylistToSet: (
    sourceId: StreamSourceId,
    playlistId: string,
    targetSetId: string,
    opts?: { download?: boolean; onProgress?: (done: number, total: number) => void },
  ) => Promise<AddHitsResult>;
  /** Download a streamed track's media for offline play (Phase 5); no-op if already cached. */
  downloadStreamedTrack: (trackId: string) => Promise<void>;
  /** Download every not-yet-cached streamed track in a set to local blobs. */
  downloadStreamedSet: (setId: string) => Promise<void>;
  next: () => Promise<void>;
  /** Previous track without the transport-button "restart current after 3s" rule. */
  skipPrev: () => Promise<void>;
  prev: () => Promise<void>;
  /** Read the track that a manual next/previous action would move to. */
  peekTrack: (direction: "next" | "prev") => Track | undefined;
  /** Read the next N manual-advance tracks in playback order without mutating state. */
  peekUpcomingTracks: (count: number) => Track[];
  /**
   * Read the ±radius window of tracks around an ARBITRARY center index (mode-aware:
   * shuffle / repeat / wrap), for the cover pager. The center may LEAD the committed
   * `currentIndex` while a drag window is open, so it's a parameter, not `currentIndex`.
   * `prev[k]` is the track at window offset -(k+1), `next[k]` at +(k+1) (nearest-first).
   * Arrays are shorter than `radius` at a repeat-off boundary. Never mutates state.
   */
  peekWindowFrom: (
    centerIndex: number,
    radius: number,
  ) => { prev: Track[]; current: Track | undefined; next: Track[] };
  /**
   * One mode-aware manual step from an arbitrary center index (+1 = next, -1 = prev),
   * for recentering the cover window. Returns the new center, or the same index when
   * there is no distinct track that way (repeat-off boundary / single track). Never
   * mutates the shuffle order (peek semantics — the real reshuffle happens on commit).
   */
  stepCenter: (centerIndex: number, dir: 1 | -1) => number;
  /**
   * Mark a cover-pager drag window as open/closed. While open, DJ auto-extend is
   * held off so queue mutations can't desync the window (rule: don't fight the
   * user's finger). Module-scope flag; does not trigger a re-render.
   */
  setCoverGestureActive: (active: boolean) => void;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setRepeat: (mode: RepeatMode) => void;
  setShuffle: (on: boolean) => void;
  setDisplayMode: (mode: SetDisplayMode) => Promise<void>;
  /** Import uploaded audio/video files into the active set. */
  addUploads: (files: FileList | File[]) => Promise<void>;
  /** Import uploaded files into a SPECIFIC set (e.g. the gallery detail page). */
  addUploadsToSet: (setId: string, files: FileList | File[]) => Promise<void>;
  /**
   * Drop-to-upload: import media into the active set, creating an upload set
   * first when nothing is active. Returns whether a new set was created (so the
   * UI can surface it). `newSetName` is supplied by the caller (i18n lives in UI).
   */
  ingestDroppedMedia: (files: File[], newSetName: string) => Promise<{ createdSet: boolean }>;
  /**
   * Desktop only: pick a local folder, import its plaintext media into the
   * active set (creating one named after the folder if none is active), and
   * remember it for incremental re-sync on later launches. No-op in the browser.
   * Resolves true when a folder was picked and imported, false on cancel/web.
   */
  importFolder: () => Promise<boolean>;
  /**
   * Desktop only: pick a folder and import its media into an EXISTING set (the
   * set-detail "import folder" button), binding it for incremental re-sync.
   * Resolves true when a folder was picked and imported, false on cancel/web.
   */
  importFolderIntoSet: (setId: string) => Promise<boolean>;
  /**
   * Desktop only: re-scan every remembered folder and import files not already
   * in the library. Safe to call on boot; no-op in the browser or when none.
   */
  syncImportFolders: () => Promise<void>;
  /**
   * Delete a 歌单. With `purgeExclusiveTracks`, also permanently delete songs that
   * live only in this set. Resets the active session if it was the deleted one.
   * Resolves the number of tracks permanently purged.
   */
  deleteSession: (sessionId: string, purgeExclusiveTracks: boolean) => Promise<number>;
  /** Manually ask the DJ to draft more now. */
  draftNow: () => Promise<void>;
}

// Non-reactive singletons (never selected by components → no rerenders).
let mediaEngine: MediaEngine | null = null;
let mediaSessionArtworkObjectUrl: string | null = null;
/** Monotonic token discarding stale async metadata updates (PRD F-12). */
let mediaSessionMetadataSeq = 0;
let mediaSessionMetadataTimer: ReturnType<typeof setTimeout> | null = null;
let mediaSessionMetadataScheduleSeq = 0;

/** Access the shared media engine (for the stage to mount + the visualizer). */
export function getMediaEngine(): MediaEngine | null {
  return mediaEngine;
}

// The 播放列表 subscription (in init) drives `queue` for the app lifetime —
// fire-and-forget, never torn down. `setSub` watches the active 歌单 and appends
// its newly-added tracks (DJ / upload) onto the queue, tracked by id (not count)
// so it's correct now that new tracks PREPEND to the set — and so user-removed
// tracks don't come back.
let setSub: Subscription | null = null;
let setSubSessionId: string | null = null;
let consumedTrackIds = new Set<string>();
let djEngine: DjEngine | null = null;
let pumping = false;
let loadedTrackId: string | null = null;
let activePlaybackTrace: PlaybackTraceContext | null = null;
let playbackLoadSeq = 0;
let playbackLoadAbort: AbortController | null = null;
// Streamed tracks auto-skipped in this play-run because they failed to resolve
// (VIP / unavailable). Reset on any successful load or hard stop. Tracking ids
// instead of a raw counter lets a whole VIP playlist stop after one pass, even
// when repeat/shuffle would otherwise wrap back to the first failed track.
let streamSkipRunTrackIds = new Set<string>();
const MAX_STREAM_SKIP_RUN = 30;
let lyricsAbort: AbortController | null = null;
let lyricsTimer: ReturnType<typeof setTimeout> | null = null;
let playbackSettingsLoaded = false;
// The active shuffled play order (queue indices). Non-reactive: next/prev read it,
// setShuffle rebuilds it, and it self-heals when stale vs the queue length.
let shuffleOrder: number[] = [];
// True while a cover-pager drag window is open. Non-reactive (module scope, rule 6):
// the gesture owns the visual window, so DJ auto-extend is held off until it settles
// (no queue mutation under the user's finger). Flipped by `setCoverGestureActive`.
let coverGestureActive = false;
const playbackListenTracker = createPlaybackListenTracker();
let presenceCoordinator: R2PresenceCoordinator | null = null;
let presenceCoordinatorKey = "";
// Signature of the last `queue` we published, so a playQueue-row write that
// doesn't change the rendered list (e.g. a future currentIndex / repeat persist)
// doesn't churn the `queue` array and re-render every list consumer.
let lastQueueSig = "";
let playQueueHydrated = false;
let queueCursorPersistTimer: number | null = null;
let queueCursorPersistSeq = 0;
let lastPersistedQueueIndex = -1;
let importProgressClearTimer: ReturnType<typeof setTimeout> | null = null;
// Timestamp of the last playIndex switch dispatch (perf only). Read by the now-playing
// stage's layout effect to measure switch→React-commit, decomposing switch.toFrame
// (switch→paint) into render+reconcile vs layout+paint (switch-fps Phase 4).
let lastSwitchStartedAt = 0;
/** Perf only: when the last playIndex switch was dispatched (see lastSwitchStartedAt). */
export function getLastSwitchStartedAt(): number {
  return lastSwitchStartedAt;
}
const playbackLog = createDiagnosticLogger("player.playback");
const mediaSessionLog = createDiagnosticLogger("player.mediaSession");
const QUEUE_CURSOR_PERSIST_DEBOUNCE_MS = 900;

type PlaybackTraceContext = Pick<
  DiagnosticContext,
  "traceId" | "trackId" | "sessionId" | "sourceId"
>;
type StreamMediaTraceContext = Pick<
  DiagnosticContext,
  "traceId" | "trackId" | "sessionId" | "sourceId" | "videoId"
>;

export interface PlaybackLoadingState {
  trackId: string;
  title: string;
  sourceKind: PlaybackSourceKind;
  startedAt: number;
}

interface PlaybackLoadRequest {
  id: number;
  controller: AbortController;
}

interface UploadIngestOptions {
  onCopyProgress?: (progress: { bytesLoaded: number; bytesTotal: number }) => void;
}

/** Cheap signature of what the queue list renders (ids + generation status +
 * cover identity/metadata). Cover fields are included so a cover edit or palette
 * backfill on the current track republishes `queue` and the visual layer reacts
 * live — without them, a cover-only change keeps the same sig and gets swallowed. */
function queueSig(tracks: Track[]): string {
  return tracks
    .map((t) => {
      const c = t.coverCrop;
      const crop = c ? `${c.x},${c.y},${c.width},${c.height}` : "";
      const palette = (t.coverPalette ?? []).map((rgb) => `${rgb.r},${rgb.g},${rgb.b}`).join(";");
      return `${t.id}:${t.status}:${t.blobId ?? ""}:${t.remoteMediaUrl ?? ""}:${t.coverBlobId ?? ""}:${t.remoteCoverUrl ?? ""}:${crop}:${t.coverThumbhash ?? ""}:${t.coverPaletteSource ?? ""}:${palette}`;
    })
    .join("|");
}

/** Cheap structural key over the queue's entry ids — detects append / prepend /
 *  replace / reorder so the tracks materialization re-subscribes only when the
 *  LIST changed, not on a cursor move. Position-sensitive O(n) arithmetic hash,
 *  no big string allocation (vs joining ~5983 ids every cursor write). */
export function queueEntriesKey(ids: string[]): string {
  let h = 0;
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    h = (Math.imul(h, 31) + i) | 0;
    for (let j = 0; j < id.length; j += 1) {
      h = (Math.imul(h, 31) + id.charCodeAt(j)) | 0;
    }
  }
  return `${ids.length}:${h}`;
}

function currentTrack(state: PlayerState): Track | undefined {
  return state.currentIndex >= 0 ? state.queue[state.currentIndex] : undefined;
}

function playableDurationSec(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function cursorPatch(
  queue: Track[],
  currentIndex: number,
  wantPlay: boolean,
): Pick<PlayerState, "currentIndex" | "wantPlay" | "positionSec" | "durationSec"> {
  const track = currentIndex >= 0 ? queue[currentIndex] : undefined;
  return {
    currentIndex,
    wantPlay,
    positionSec: 0,
    durationSec: playableDurationSec(track?.durationSec),
  };
}

function startPlaybackTrace(track: Track): PlaybackTraceContext {
  const mediaSource = describeTrackMediaSource(track);
  const coverSource = describeTrackCoverSource(track);
  const trace: PlaybackTraceContext = {
    traceId: createTraceId("ply"),
    trackId: track.id,
    sessionId: track.sessionId,
    sourceId: track.streamSourceId,
  };
  activePlaybackTrace = trace;
  playbackLog.info("playback.start", {
    message: "playback attempt started",
    ...trace,
    category: "media",
    phase: "start",
    sourceKind: playbackSourceKind(track),
    mediaSourceKind: mediaSource.kind,
    mediaSourceHost: mediaSource.host || undefined,
    coverSourceKind: coverSource.kind,
    coverSourceHost: coverSource.host || undefined,
    trackKind: track.kind,
  });
  return trace;
}

function beginPlaybackLoading(
  set: (p: Partial<PlayerState>) => void,
  track: Track,
  sourceKind: PlaybackSourceKind,
): PlaybackLoadRequest {
  playbackLoadSeq += 1;
  playbackLoadAbort?.abort();
  const controller = new AbortController();
  playbackLoadAbort = controller;
  set({
    playbackLoading: {
      trackId: track.id,
      title: track.title,
      sourceKind,
      startedAt: Date.now(),
    },
  });
  return { id: playbackLoadSeq, controller };
}

function isPlaybackLoadCurrent(requestId: number): boolean {
  return playbackLoadSeq === requestId;
}

function clearPlaybackLoading(set: (p: Partial<PlayerState>) => void, requestId: number): void {
  if (!isPlaybackLoadCurrent(requestId)) return;
  playbackLoadAbort = null;
  set({ playbackLoading: null });
}

function cancelPlaybackLoading(set: (p: Partial<PlayerState>) => void): void {
  playbackLoadSeq += 1;
  playbackLoadAbort?.abort();
  playbackLoadAbort = null;
  set({ playbackLoading: null });
}

function isPlaybackRequestSeqCurrent(requestId: number | undefined): boolean {
  return requestId === undefined || isPlaybackLoadCurrent(requestId);
}

function shouldContinuePlaybackCursor(
  get: () => PlayerState,
  track: Track,
  requestId: number | undefined,
  stage: string,
): boolean {
  const activeTrackId = currentTrack(get())?.id;
  if (activeTrackId === track.id && isPlaybackRequestSeqCurrent(requestId)) return true;
  log.debug("player", "discard stale playback load", {
    trackId: track.id,
    activeTrackId,
    requestId,
    currentRequestId: playbackLoadSeq,
    stage,
  });
  return false;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensurePlaybackTrace(track: Track, wantPlay: boolean): PlaybackTraceContext | undefined {
  if (!wantPlay) return undefined;
  if (activePlaybackTrace?.trackId === track.id) return activePlaybackTrace;
  return startPlaybackTrace(track);
}

function tracePlaybackLoad(
  event: string,
  track: Track,
  trace: PlaybackTraceContext | undefined,
  context: Pick<
    DiagnosticContext,
    "bytes" | "mime" | "sourceId" | "requestHost" | "requestPathHash" | "redactions"
  > & {
    transport: "blob" | "local-file" | "remote" | "direct" | "media-proxy";
    safeQuery?: Record<string, string>;
    hasPot?: boolean;
    hasSig?: boolean;
    hasNParam?: boolean;
    proxied?: boolean;
  },
): void {
  if (!trace?.traceId) return;
  const mediaSource = describeTrackMediaSource(track);
  const coverSource = describeTrackCoverSource(track);
  playbackLog.info(event, {
    message: "media source loading",
    ...trace,
    ...context,
    category: "media",
    phase: "start",
    mediaSourceKind: mediaSource.kind,
    mediaSourceHost: mediaSource.host || undefined,
    coverSourceKind: coverSource.kind,
    coverSourceHost: coverSource.host || undefined,
    trackKind: track.kind,
  });
}

function streamMediaTrace(track: Track, trace: PlaybackTraceContext | undefined) {
  if (!trace) return undefined;
  return {
    ...trace,
    sourceId: track.streamSourceId,
    videoId: track.streamSourceId === "youtube" ? track.streamExternalId : undefined,
  } satisfies StreamMediaTraceContext;
}

/**
 * Download a resolved stream's full bytes through the media proxy — same routing as
 * playback (inject Referer/UA via the proxy, read ACAO-clean bytes). Throws on a
 * network / empty-body failure. Shared by offline-cache and download-before-play so
 * the proxy routing lives in exactly one place.
 */
async function fetchStreamMediaBytes(
  track: Track,
  url: string,
  headers: Record<string, string> | undefined,
  trace?: PlaybackTraceContext,
): Promise<Blob> {
  const bridge = resolveDesktopBridge();
  const target = url.startsWith("blob:")
    ? url
    : bridge.mediaProxyUrl
      ? bridge.mediaProxyUrl(url, headers, streamMediaTrace(track, trace))
      : url;
  const resp = target.startsWith("muzfetch://")
    ? await fetch(target)
    : await (await getAppFetch())(target);
  if (!resp.ok) throw new Error(`download failed (${resp.status})`);
  const blob = await resp.blob();
  if (blob.size === 0) throw new Error("empty media");
  return blob;
}

/**
 * Download-before-play wrapper: like {@link fetchStreamMediaBytes} but returns null
 * (logged) instead of throwing, so a failed download degrades to plain streaming
 * rather than killing playback.
 */
async function downloadStreamForPlayback(
  track: Track,
  url: string,
  headers: Record<string, string> | undefined,
  trace?: PlaybackTraceContext,
): Promise<Blob | null> {
  try {
    return await fetchStreamMediaBytes(track, url, headers, trace);
  } catch (err) {
    log.warn("player", "download-before-play failed; streaming instead", {
      trackId: track.id,
      source: track.streamSourceId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function streamUrlTraceContext(url: string) {
  const safeUrl = sanitizeUrlForTrace(url);
  const params = parseUrlParams(url);
  return {
    requestHost: safeUrl.host ?? undefined,
    requestPathHash: safeUrl.pathHash,
    safeQuery: safeUrl.safeQuery,
    redactions: safeUrl.redactions,
    hasPot: params?.has("pot") ?? false,
    hasSig: (params?.has("sig") || params?.has("lsig") || params?.has("signature")) ?? false,
    hasNParam: params?.has("n") ?? false,
  };
}

function parseUrlParams(url: string): URLSearchParams | null {
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  activeSessionId: null,
  queueSource: undefined,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  wantPlay: false,
  playbackLoading: null,
  positionSec: 0,
  durationSec: 0,
  volume: 0.9,
  repeat: "all",
  shuffle: false,
  displayMode: "video",
  djEnabled: true,
  isDrafting: false,
  isGenerating: false,
  isUploading: false,
  importProgress: null,
  djError: null,

  init() {
    if (mediaEngine) return;
    mediaEngine = new MediaEngine({
      // Repeat-one is an ended-track behavior only; manual next still advances.
      onEnded: () => {
        flushPlaybackListen(Date.now());
        void publishPlaybackPresence("stopped", get());
        const state = get();
        if (state.repeat === "one" && state.currentIndex >= 0) {
          state.seek(0);
          void state.playIndex(state.currentIndex);
          return;
        }
        void state.next();
      },
      onTimeUpdate: (positionSec, durationSec) => {
        const track = currentTrack(get());
        if (!track || loadedTrackId !== track.id) return;
        const nextDuration =
          playableDurationSec(durationSec) || playableDurationSec(track?.durationSec);
        set({ positionSec, durationSec: nextDuration });
        observePlaybackListen(get(), positionSec, nextDuration);
      },
      onPlayStateChange: (isPlaying) => {
        if (!isPlaying) flushPlaybackListen(Date.now());
        set({ isPlaying });
        setPlatformMediaSessionPlaybackState(isPlaying ? "playing" : "paused");
      },
      onError: (error) => {
        // A playback failure is a notification, not dock chrome — keep it out
        // of the status line (djError stays reserved for DJ/upload errors).
        notify.error(i18n.t("player.playbackError"), {
          detail: describePlaybackError(error),
          error,
        });
        log.warn("player", "playback error", error);
      },
    });
    mediaEngine.setVolume(get().volume);
    // Wire hardware media keys / OS now-playing widget to transport once. Handlers
    // read fresh state via get() on each press, so registering a single time is safe.
    setPlatformMediaSessionActionHandlers({
      play: () => void get().play(),
      pause: () => get().pause(),
      previoustrack: () => void get().prev(),
      nexttrack: () => void get().next(),
    });
    void hydratePlaybackSettings(set, get).catch((err: unknown) =>
      log.warn("player", "failed to hydrate playback settings", err),
    );
    void get()
      .rebuildEngine()
      .catch((err: unknown) => log.warn("player", "failed to build DJ engine", err));

    // The player consumes the persistent 播放列表 (Play Queue), not a 歌单 directly.
    // ORDER / CONTENT are decoupled so NO list-level query ever observes full row
    // content (PRD scalable-track-list-reactivity, Axis B-1). Otherwise editing ANY
    // queue track re-fired getTracksByIds(N) and republished the whole queue (the
    // scenario-4 fan-out: @5983 a single tag edit cost a ~385ms refetch ×N):
    //   • playQueue sub (cheap): entries ids / cursor / context session. Re-fires
    //     on cursor/entries/session change; never materializes tracks.
    //   • queue snapshot (ORDER): getTracksByIds is a ONE-SHOT fetch refreshed only
    //     when the entries STRUCTURE changes (add/remove/reorder) — NOT a liveQuery,
    //     so a track's content write never re-fires it.
    //   • current-row sub (CONTENT): a single-row liveQuery on the CURRENT track id
    //     only (re-targeted as the cursor moves). Editing the current track patches
    //     just its slot so Now Playing stays reactive; editing a non-current track
    //     touches nothing here (its row reactivity is the windowed useTrack, Phase 4).
    let latestPq: Awaited<ReturnType<typeof getPlayQueue>> | null = null;
    let latestSession: Awaited<ReturnType<typeof getSession>>;
    let latestQueue: Track[] | null = null;
    let trackEntriesKey = "";

    const processQueueUpdate = () => {
      const pq = latestPq;
      const queue = latestQueue;
      if (!pq || !queue) return;
      const session = latestSession;
      // PERF PROBE (switch-fps): the synchronous processing below — notably
      // `queueSig(queue)`, an O(n) string build over every track — runs on EVERY
      // fire even when nothing the list renders actually changed (`!changed`
      // early-returns AFTER paying for it). This span attributes that cost.
      const processStart = performance.now();
      const contextSetId = pq.contextSetId ?? null;
      watchSetForAppend(
        contextSetId,
        pq.entries.map((e) => e.trackId),
      );

      const sig = queueSig(queue);
      const listChanged = sig !== lastQueueSig;
      lastQueueSig = sig;
      const persistedIndex = clampIndex(queue.length, pq.currentIndex);
      lastPersistedQueueIndex = persistedIndex;
      const state = get();
      // Hydrate from persisted cursor on boot, and reconcile by the current UI
      // track id when the queue structure changes. A clicked online/R2 track can
      // be the visible current track before its media finishes loading, so using
      // only `loadedTrackId` here would bounce the UI back to the previous song
      // when the set watcher appends/seeds the queue a moment later.
      const shouldHydrateCursor = !playQueueHydrated || listChanged;
      playQueueHydrated = true;
      const previousTrackId = currentTrack(state)?.id;
      const cursorAnchorId = previousTrackId ?? loadedTrackId;
      const currentIndex = shouldHydrateCursor
        ? reconcileCurrentIndex(
            queue.map((tr) => tr.id),
            cursorAnchorId,
            persistedIndex,
          )
        : clampIndex(queue.length, state.currentIndex);
      const nextTrack = currentIndex >= 0 ? queue[currentIndex] : undefined;
      const nextTrackId = nextTrack?.id;
      const metadataDuration = playableDurationSec(nextTrack?.durationSec);
      const queueSource: QueueSource | undefined = contextSetId
        ? state.queueSource?.kind === "set" && state.queueSource.setId === contextSetId
          ? state.queueSource
          : { kind: "set", setId: contextSetId }
        : state.queueSource;
      const patch: Partial<PlayerState> = {
        activeSessionId: contextSetId,
        currentIndex,
        queueSource,
        displayMode: session?.displayMode ?? state.displayMode,
        djEnabled: session?.config.autoExtend ?? false,
      };
      if (listChanged) patch.queue = queue;
      if (!nextTrackId) {
        patch.positionSec = 0;
        patch.durationSec = 0;
      } else if (nextTrackId !== previousTrackId) {
        patch.positionSec = 0;
        patch.durationSec = metadataDuration;
      } else if (metadataDuration > 0 && state.durationSec <= 0) {
        patch.durationSec = metadataDuration;
      }
      const changed =
        listChanged ||
        state.activeSessionId !== patch.activeSessionId ||
        state.queueSource !== patch.queueSource ||
        state.currentIndex !== patch.currentIndex ||
        state.displayMode !== patch.displayMode ||
        state.djEnabled !== patch.djEnabled ||
        ("positionSec" in patch && state.positionSec !== patch.positionSec) ||
        ("durationSec" in patch && state.durationSec !== patch.durationSec);
      if (!changed) {
        notePerfWork("queue.live.process", performance.now() - processStart, {
          changed: false,
          listChanged,
          tracks: queue.length,
        });
        return;
      }
      set(patch);
      void afterQueueUpdate(set, get);
      notePerfWork("queue.live.process", performance.now() - processStart, {
        changed: true,
        listChanged,
        tracks: queue.length,
      });
    };

    // ORDER snapshot: a ONE-SHOT materialize of the current entries' track rows.
    // NOT a liveQuery — so a queue track's content write never re-fires it. Refetched
    // only when the entries STRUCTURE changes (add/remove/reorder), which is the only
    // time the ids→content mapping can actually change for non-current rows.
    const refreshQueueSnapshot = async (ids: string[]) => {
      const fetchStart = performance.now();
      const queue = await getTracksByIds(ids);
      notePerfWork("queue.live.fetch", performance.now() - fetchStart, { tracks: queue.length });
      latestQueue = queue;
      processQueueUpdate();
      retargetCurrentRow();
    };

    // CONTENT sub: a single-row liveQuery on the CURRENT track id, re-targeted as the
    // cursor moves. Editing the current track patches just its slot (a fresh `queue`
    // array) so Now Playing / the current-row highlight stay reactive — without ever
    // observing the other N-1 rows. `rowSig` gates out no-op republishes so a switch
    // doesn't pay an extra render.
    const rowSig = (t: Track): string =>
      `${t.status}:${t.title ?? ""}:${t.blobId ?? ""}:${t.remoteMediaUrl ?? ""}:${t.coverBlobId ?? ""}:${t.remoteCoverUrl ?? ""}:${t.coverThumbhash ?? ""}:${t.note ?? ""}:${(t.tags ?? []).join(",")}:${t.durationSec ?? 0}`;
    let currentRowSub: Subscription | null = null;
    let currentRowId: string | null = null;
    let currentRowSig = "";

    function retargetCurrentRow() {
      const s = get();
      const slot = s.currentIndex >= 0 ? s.queue[s.currentIndex] : undefined;
      const id = slot?.id ?? null;
      if (id === currentRowId) return;
      currentRowId = id;
      currentRowSig = slot ? rowSig(slot) : "";
      currentRowSub?.unsubscribe();
      currentRowSub = null;
      if (!id) return;
      currentRowSub = liveQuery(() => getTrack(id)).subscribe({
        next: (fresh) => {
          if (!fresh) return;
          const st = get();
          const idx = st.currentIndex;
          if (idx < 0 || st.queue[idx]?.id !== id) return;
          const sig = rowSig(fresh);
          if (sig === currentRowSig) return; // no render-relevant change
          currentRowSig = sig;
          const nextQueue = st.queue.slice();
          nextQueue[idx] = fresh;
          latestQueue = nextQueue;
          set({ queue: nextQueue });
        },
        error: (err) => log.error("player", "current track row subscription error", err),
      });
    }
    // Re-target whenever the cursor / current id changes (cheap; diffed by id).
    usePlayerStore.subscribe(retargetCurrentRow);

    // Cheap sub: playQueue (entries / cursor) + the context session. Re-fires on a
    // cursor write but only re-processes the cached snapshot (no refetch); refreshes
    // the snapshot only when the entries STRUCTURE changes.
    liveQuery(async () => {
      const pq = await getPlayQueue();
      const session = pq.contextSetId ? await getSession(pq.contextSetId) : undefined;
      return { pq, session };
    }).subscribe({
      next: ({ pq, session }) => {
        latestPq = pq;
        latestSession = session;
        const ids = pq.entries.map((e) => e.trackId);
        const key = queueEntriesKey(ids);
        if (key !== trackEntriesKey) {
          // Entries structure changed → refetch the snapshot once on the new id set.
          trackEntriesKey = key;
          void refreshQueueSnapshot(ids);
          return;
        }
        // Cursor / session-only change → reprocess the cached snapshot (no refetch).
        processQueueUpdate();
        retargetCurrentRow();
      },
      error: (err) => log.error("player", "play-queue subscription error", err),
    });
  },

  async rebuildEngine() {
    const settings = await getSettings();
    const provider = resolveMusicGenProvider(settings);
    const brain = createAiDjBrain(settings);
    djEngine = createDjEngine({ db, brain, provider });
  },

  async setActiveSession(sessionId) {
    log.debug("player", "setActiveSession start", { sessionId });
    get().init();
    await get().rebuildEngine();
    watchSetForAppend(null, [], true);

    const session = await getSession(sessionId);
    const trackIds = session?.trackIds ?? [];
    loadedTrackId = null;
    cancelPlaybackLoading(set);

    // Load this 歌单 into the 播放列表 (replace) and mark how many of its tracks the
    // queue has consumed (high-water). Also seed `queue` synchronously so callers
    // that read it right after (e.g. playTrack) don't race the liveQuery.
    await playQueueSet(trackIds, { contextSetId: sessionId, currentIndex: -1 });
    consumedTrackIds = new Set(trackIds);
    const initialQueue = await getTracksByIds(trackIds);
    lastQueueSig = queueSig(initialQueue); // keep the guard in sync with the optimistic seed
    set({
      activeSessionId: sessionId,
      queueSource: { kind: "set", setId: sessionId },
      queue: initialQueue,
      currentIndex: -1,
      wantPlay: false,
      playbackLoading: null,
      positionSec: 0,
      durationSec: 0,
      displayMode: session?.displayMode ?? "video",
      djEnabled: session?.config.autoExtend ?? false,
    });
    log.debug("player", "setActiveSession seeded queue", {
      sessionId,
      queueLength: initialQueue.length,
      currentIndex: -1,
    });
    await saveSettings({ lastSessionId: sessionId });
    watchSetForAppend(sessionId, trackIds, true);

    // Seed an empty DJ set with a first batch.
    if (session?.config.autoExtend && trackIds.length === 0) void get().draftNow();
  },

  async playSystemPlaylist(playlistId, tracks) {
    log.debug("player", "playSystemPlaylist start", {
      playlistId,
      trackCount: tracks.length,
    });
    get().init();
    await get().rebuildEngine();
    watchSetForAppend(null, [], true);

    const trackIds = tracks.map((track) => track.id);
    loadedTrackId = null;
    cancelPlaybackLoading(set);
    await playQueueSet(trackIds, { currentIndex: -1 });
    consumedTrackIds = new Set(trackIds);
    lastQueueSig = queueSig(tracks);
    set({
      activeSessionId: null,
      queueSource: { kind: "system-playlist", id: playlistId },
      queue: tracks,
      currentIndex: -1,
      wantPlay: false,
      playbackLoading: null,
      positionSec: 0,
      durationSec: 0,
      displayMode: "video",
      djEnabled: false,
    });
  },

  async play() {
    set({ wantPlay: true });
    const { currentIndex, queue } = get();
    if (currentIndex < 0 && queue.length > 0) {
      await get().playIndex(0);
      return;
    }
    await ensureLoadedAndPlay(set, get);
  },

  pause() {
    set({ wantPlay: false });
    cancelPlaybackLoading(set);
    mediaEngine?.pause();
    void publishPlaybackPresence("paused", get());
  },

  togglePlay() {
    if (get().isPlaying) get().pause();
    else void get().play();
  },

  async playIndex(index) {
    cancelPlaybackLoading(set);
    const selectionRequestId = playbackLoadSeq;
    const state = get();
    const { queue } = state;
    const clamped = clampIndex(queue.length, index);
    const target = clamped >= 0 ? queue[clamped] : undefined;
    const sourceKind = target ? playbackSourceKind(target) : "none";
    // Switch-by-switch narrative for the perf trace: `hasCover` flags the
    // cover-bearing switches that run the decode/upload pipeline (the ones that
    // tank FPS), `sourceKind` whether the audio load also did network/IPC work.
    log.debug("player", "playIndex", {
      requestedIndex: index,
      queueLength: queue.length,
      ...describeTrackSwitch({ from: state.currentIndex, to: clamped, track: target, sourceKind }),
    });
    if (target) startPlaybackTrace(target);
    // Main-thread switch cost: the React re-render from set(cursorPatch) is deferred,
    // so wrapping set() can't time it. Measure switch→next-paint instead — the rAF
    // fires only after the synchronous render + layout that the switch triggered, so
    // this delta is the end-to-end main-thread-blocked latency to the first frame
    // (switch-fps Phase 4 observability).
    const switchStartedAt = performance.now();
    lastSwitchStartedAt = switchStartedAt;
    set(cursorPatch(queue, clamped, true));
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        notePerfWork("player.switch.toFrame", performance.now() - switchStartedAt, {
          to: clamped,
          hasCover: Boolean(target?.coverBlobId),
        });
      });
    }
    persistQueueIndex(clamped);
    await ensureLoadedAndPlay(set, get, selectionRequestId);
    void maybeRefill(set, get);
  },

  async cueIndex(index) {
    cancelPlaybackLoading(set);
    const selectionRequestId = playbackLoadSeq;
    const { queue } = get();
    const clamped = clampIndex(queue.length, index);
    // wantPlay:false makes ensureLoadedAndPlay load + show the track but skip
    // play() — so a fresh launch never fires a gesture-blocked play() / spins up
    // the AudioContext before the user has interacted.
    set(cursorPatch(queue, clamped, false));
    persistQueueIndex(clamped);
    await ensureLoadedAndPlay(set, get, selectionRequestId);
  },

  async playTrack(track) {
    log.debug("player", "playTrack start", {
      trackId: track.id,
      sessionId: track.sessionId,
      activeSessionId: get().activeSessionId,
      queueLength: get().queue.length,
    });
    if (get().activeSessionId !== track.sessionId) {
      await get().setActiveSession(track.sessionId);
    }
    const idx = get().queue.findIndex((t) => t.id === track.id);
    log.debug("player", "playTrack resolved index", {
      trackId: track.id,
      index: idx,
      queueLength: get().queue.length,
    });
    if (idx >= 0) await get().playIndex(idx);
  },

  async playNextTrack(track) {
    log.debug("player", "playNextTrack", { trackId: track.id });
    await playQueuePlayNext([track.id]);
  },

  async playRequestNow(track) {
    log.debug("player", "playRequestNow", { trackId: track.id });
    // Cut in right after the slot that's ACTUALLY playing, then skip to it — keeping the
    // rest of the queue intact. Unlike playTrack, we do NOT setActiveSession, so a request
    // from another set cuts in over the host's playlist and the host's set resumes after
    // it (and keeps driving autoExtend).
    //
    // We insert at an EXPLICIT position (store cursor + 1) and play THAT exact slot, rather
    // than going through playQueuePlayNext (which inserts relative to the persisted DB
    // cursor) and then playing `currentIndex + 1`. The store cursor and the debounced DB
    // cursor can diverge by one, which made the cut-in land one slot off — silently playing
    // the NEXT track and skipping the requested one.
    const cur = get().currentIndex;
    if (cur < 0) {
      // Idle: nothing playing — append and play wherever it lands.
      await playQueuePlayNext([track.id]);
      const landed = await waitForQueueIndex(get, track.id);
      if (landed == null) {
        const idx = await ensureTrackInCurrentPlayQueue(set, get, track.id);
        if (idx >= 0) await get().playIndex(idx);
        return;
      }
      await get().playIndex(landed);
      return;
    }
    const slot = cur + 1;
    await playQueueInsertAt(slot, [track.id]);
    // Confirm the cut-in materialized at the exact slot before playing it (robust to
    // duplicate trackIds and to the cursor reconcile shifting the store cursor).
    const ok = await waitForQueueSlot(get, slot, track.id);
    if (!ok) {
      const idx = await ensureTrackInCurrentPlayQueue(set, get, track.id);
      if (idx >= 0) await get().playIndex(idx);
      return;
    }
    await get().playIndex(slot);
  },

  async playRequestNext(track) {
    log.debug("player", "playRequestNext", { trackId: track.id });
    // Queue into the FIFO request block after the slot that's ACTUALLY playing (store
    // cursor), NOT the persisted DB cursor — which can lag by one in the post-switch
    // debounce window and drop the request behind the playing track. We don't switch the
    // cursor: the request plays when the current track (and any earlier requests) finish.
    await playQueueRequestNextAt(get().currentIndex, [track.id]);
  },

  async playStreamedHit(hit) {
    // Import the online song into the dedicated "online" set (deduped) and play it.
    // If the set is already active we let its watcher append the new track to the live
    // queue and DON'T re-run setActiveSession — doing both would playQueueSet AND race
    // the watcher's append, queueing the song twice. If it's not active, activate it
    // (which seeds the queue from trackIds). Then wait for the track to land + play.
    const setId = await ensureOnlineSet();
    const track = await createStreamedTrack(hitToStreamedInput(setId, hit));
    // Persist the cover as a blob (best-effort, non-blocking) so it survives offline.
    if (track.remoteCoverUrl && !track.coverBlobId) {
      void cacheStreamTrackCover({ trackId: track.id, coverUrl: track.remoteCoverUrl });
    }
    const alreadyActive = get().activeSessionId === setId;
    const session = await getSession(setId);
    if (!session?.trackIds.includes(track.id)) await prependTrackIds(setId, [track.id]);
    if (!alreadyActive) await get().setActiveSession(setId);
    const idx =
      (await waitForQueueIndex(get, track.id)) ??
      (await ensureTrackInCurrentPlayQueue(set, get, track.id));
    if (idx >= 0) {
      await get().playIndex(idx);
    } else {
      log.warn("player", "streamed track did not enter play queue", { trackId: track.id, setId });
    }
  },

  async playStreamedHits(hits) {
    if (hits.length === 0) return;
    // Queue the tail into the online set first (in order, deduped), then play the head
    // via the proven single-play path — which handles set creation/activation + the
    // active-set watcher race exactly once, so order ends up [hit0, hit1, …, hitN].
    if (hits.length > 1) {
      const setId = await ensureOnlineSet();
      await addHitsToSet(setId, hits.slice(1));
      void cacheStreamPlaylistTrackCovers({ sessionId: setId, hits: hits.slice(1) });
    }
    await get().playStreamedHit(hits[0]);
  },

  async importStreamedPlaylist(sourceId, playlistId, name, opts) {
    const hits = await fetchPlaylistHits(sourceId, playlistId);
    if (hits.length === 0) return 0;
    // Tag the new set with the playlist ref so a later sync can offer incremental re-sync.
    const session = await createSession({
      name,
      seedPrompt: "",
      config: { autoExtend: false },
      streamPlaylistRef: { source: sourceId, id: playlistId },
    });
    if (opts?.coverUrl) {
      void cacheStreamPlaylistCover({ sessionId: session.id, coverUrl: opts.coverUrl });
    }
    const { added } = await addHitsToSet(session.id, hits, undefined, opts?.onProgress);
    void cacheStreamPlaylistTrackCovers({ sessionId: session.id, hits });
    if (opts?.download) void downloadStreamedSetTracks(session.id);
    return added;
  },

  async addStreamedPlaylistToSet(sourceId, playlistId, targetSetId, opts) {
    const hits = await fetchPlaylistHits(sourceId, playlistId);
    const result = await addHitsToSet(targetSetId, hits, undefined, opts?.onProgress);
    void cacheStreamPlaylistTrackCovers({ sessionId: targetSetId, hits });
    if (opts?.download) void downloadStreamedSetTracks(targetSetId);
    return result;
  },

  async downloadStreamedTrack(trackId) {
    const track = await getTrack(trackId);
    if (!track || !isTrackCacheableToDevice(track)) return; // no cloud source / already cached
    if (track.remoteMediaUrl) {
      const result = await cacheRemoteTrackNow(track);
      if (result.kind === "cached") {
        // Downloading "to device" should be fully offline-capable, so pull the cover
        // into a local blob too (best-effort, fire-and-forget — never blocks the toast).
        void ensureLocalCoverForTrack(trackId);
        notify.success(i18n.t("streamCache.downloaded"));
      } else if (result.kind === "failed") notify.error(i18n.t("streamCache.downloadFailed"));
      return;
    }
    if (!isStreamedTrack(track)) return;
    const result = await cacheStreamedTrackNow(track);
    if (result.kind === "cached") {
      void ensureLocalCoverForTrack(trackId);
      notify.success(i18n.t("streamCache.downloaded"));
    } else if (
      result.kind === "requires-login" ||
      (result.kind === "no-permission" && result.reason === "vip")
    ) {
      notify.error(i18n.t("player.streamNeedsAccess"));
    } else if (result.kind !== "no-permission") {
      notify.error(i18n.t("streamCache.downloadFailed"));
    }
  },

  async downloadStreamedSet(setId) {
    await downloadStreamedSetTracks(setId);
  },

  async next() {
    const { queue, currentIndex, repeat, shuffle } = get();
    let ni: number | null;
    if (shuffle) {
      const r = shuffleManualNext(shuffleOrder, queue.length, currentIndex, repeat);
      shuffleOrder = r.order;
      ni = r.index;
    } else {
      ni = manualNextIndex(queue.length, currentIndex, repeat);
    }
    if (ni === null) {
      get().pause();
      set({ isPlaying: false });
      void maybeRefill(set, get);
      return;
    }
    await get().playIndex(ni);
  },

  async skipPrev() {
    const { queue, currentIndex, repeat, shuffle } = get();
    let pi: number | null;
    if (shuffle) {
      const r = shufflePrev(shuffleOrder, queue.length, currentIndex, repeat);
      shuffleOrder = r.order;
      pi = r.index;
    } else {
      pi = prevIndex(queue.length, currentIndex, repeat);
    }
    if (pi === null || pi === currentIndex) return;
    await get().playIndex(pi);
  },

  async prev() {
    const { positionSec } = get();
    if (positionSec > 3) {
      get().seek(0);
      return;
    }
    await get().skipPrev();
  },

  peekTrack(direction) {
    const { queue, currentIndex, repeat, shuffle } = get();
    if (queue.length === 0 || currentIndex < 0) return undefined;
    let index: number | null;
    if (direction === "next") {
      if (shuffle) {
        if (shuffleOrder.length !== queue.length) return undefined;
        const r = shuffleManualNext(shuffleOrder, queue.length, currentIndex, repeat);
        index = r.index;
      } else {
        index = manualNextIndex(queue.length, currentIndex, repeat);
      }
    } else if (shuffle) {
      if (shuffleOrder.length !== queue.length) return undefined;
      const r = shufflePrev(shuffleOrder, queue.length, currentIndex, repeat);
      index = r.index;
    } else {
      index = prevIndex(queue.length, currentIndex, repeat);
    }
    if (index === null || index === currentIndex) return undefined;
    return queue[index];
  },

  peekUpcomingTracks(count) {
    const { queue, currentIndex, repeat, shuffle } = get();
    return upcomingManualIndices({
      count,
      currentIndex,
      length: queue.length,
      repeat,
      shuffleOrder: shuffle ? shuffleOrder : undefined,
    })
      .map((index) => queue[index])
      .filter((track): track is Track => Boolean(track));
  },

  peekWindowFrom(centerIndex, radius) {
    const { queue, repeat, shuffle } = get();
    const current = centerIndex >= 0 ? queue[centerIndex] : undefined;
    const { prev, next } = windowManualIndices({
      radius,
      currentIndex: centerIndex,
      length: queue.length,
      repeat,
      shuffleOrder: shuffle ? shuffleOrder : undefined,
    });
    const toTracks = (indices: number[]) =>
      indices.map((index) => queue[index]).filter((track): track is Track => Boolean(track));
    return { prev: toTracks(prev), current, next: toTracks(next) };
  },

  stepCenter(centerIndex, dir) {
    const { queue, repeat, shuffle } = get();
    const stepped = manualStepIndex({
      index: centerIndex,
      length: queue.length,
      repeat,
      dir,
      shuffleOrder: shuffle ? shuffleOrder : undefined,
    });
    return stepped ?? centerIndex;
  },

  setCoverGestureActive(active) {
    coverGestureActive = active;
  },

  seek(sec) {
    const track = currentTrack(get());
    const duration =
      playableDurationSec(get().durationSec) || playableDurationSec(track?.durationSec);
    const positionSec = duration > 0 ? Math.min(duration, Math.max(0, sec)) : Math.max(0, sec);
    if (loadedTrackId === track?.id) mediaEngine?.seek(positionSec);
    set({ positionSec, durationSec: duration || get().durationSec });
  },

  setVolume(v) {
    const volume = clampVolume(v);
    mediaEngine?.setVolume(volume);
    set({ volume });
    void saveSettings({ playerVolume: volume }).catch((err: unknown) =>
      log.warn("player", "failed to persist volume", err),
    );
  },

  setRepeat(mode) {
    set({ repeat: mode });
    void saveSettings({ playerRepeatMode: mode }).catch((err: unknown) =>
      log.warn("player", "failed to persist repeat mode", err),
    );
  },

  setShuffle(on) {
    set({ shuffle: on });
    shuffleOrder = on ? buildShuffleOrder(get().queue.length, get().currentIndex) : [];
    void saveSettings({ playerShuffle: on }).catch((err: unknown) =>
      log.warn("player", "failed to persist shuffle mode", err),
    );
  },

  async setDisplayMode(mode) {
    const { activeSessionId } = get();
    set({ displayMode: mode });
    if (activeSessionId) await setSessionDisplayMode(activeSessionId, mode);
  },

  async addUploads(files) {
    const { activeSessionId } = get();
    if (activeSessionId) await get().addUploadsToSet(activeSessionId, files);
  },

  async addUploadsToSet(setId, files) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (importProgressClearTimer) {
      clearTimeout(importProgressClearTimer);
      importProgressClearTimer = null;
    }
    let completed = 0;
    set({
      isUploading: true,
      importProgress: { phase: "importing", total: list.length, completed },
    });
    try {
      const ids: string[] = [];
      let uploaded = 0;
      let lastPublishedTrackId: string | undefined;
      const unsupported: string[] = [];
      for (const file of list) {
        set({
          importProgress: {
            phase: "importing",
            total: list.length,
            completed,
            current: {
              name: file.name,
              mode: "copy",
              bytesLoaded: 0,
              bytesTotal: file.size,
            },
          },
        });
        const r = await ingestMediaFile(setId, file, undefined, {
          onCopyProgress: ({ bytesLoaded, bytesTotal }) =>
            set({
              importProgress: {
                phase: "importing",
                total: list.length,
                completed,
                current: {
                  name: file.name,
                  mode: "copy",
                  bytesLoaded,
                  bytesTotal,
                },
              },
            }),
        });
        completed += 1;
        if (r.trackId) {
          ids.push(r.trackId);
          uploaded += 1;
          if (ids.length >= IMPORT_VISIBILITY_FLUSH_SIZE) {
            lastPublishedTrackId = await flushImportedTrackIds(setId, ids, lastPublishedTrackId);
          }
        } else if (r.unsupportedName) unsupported.push(r.unsupportedName);
        set({
          importProgress: {
            phase: "importing",
            total: list.length,
            completed,
            current: {
              name: file.name,
              mode: "copy",
              bytesLoaded: file.size,
              bytesTotal: file.size,
            },
          },
        });
      }
      lastPublishedTrackId = await flushImportedTrackIds(setId, ids, lastPublishedTrackId);
      if (unsupported.length > 0) {
        notify.warning(i18n.t("drop.skipped", { count: unsupported.length }), {
          detail: `${unsupported.join(", ")} — ${i18n.t("nowPlaying.videoUnsupported")}`,
        });
      }
      log.info("player", `uploaded ${uploaded} file(s) to ${setId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ djError: msg });
      log.error("player", "upload failed", msg);
    } finally {
      set({
        isUploading: false,
        importProgress: { phase: "done", total: list.length, completed },
      });
      importProgressClearTimer = setTimeout(() => {
        importProgressClearTimer = null;
        usePlayerStore.setState({ importProgress: null });
      }, IMPORT_PROGRESS_CLEAR_MS);
    }
  },

  async ingestDroppedMedia(files, newSetName) {
    if (files.length === 0) return { createdSet: false };
    let createdSet = false;
    if (!get().activeSessionId) {
      const session = await createSession({
        name: newSetName,
        seedPrompt: "",
        config: { autoExtend: false },
        displayMode: "video",
      });
      await get().setActiveSession(session.id);
      createdSet = true;
    }
    await get().addUploads(files);
    return { createdSet };
  },

  async importFolder() {
    if (!hasFolderAccess()) return false;
    const path = await pickFolder();
    if (!path) return false;
    await grantFolderAccess(path);

    // A folder maps to its own set: reuse it if this folder is already remembered
    // (re-sync), else create one named after the folder. Never dumps into an
    // unrelated active set, so the behavior is the same from any entry point.
    const existing = (await getSettings()).importFolders?.find((f) => f.path === path);
    let setId = existing?.setId;
    if (!setId || !(await getSession(setId))) {
      const session = await createSession({
        name: basename(path),
        seedPrompt: "",
        config: { autoExtend: false },
        displayMode: "video",
      });
      setId = session.id;
    }
    await get().setActiveSession(setId);

    // Remember it before scanning, so a crash mid-import still leaves it tracked.
    const folderId = await upsertImportFolder({
      id: existing?.id,
      path,
      setId,
      displayName: basename(path),
      recursive: existing?.recursive ?? true,
    });
    await runFolderSync([folderId]);
    return true;
  },

  async importFolderIntoSet(setId) {
    if (!hasFolderAccess()) return false;
    const path = await pickFolder();
    if (!path) return false;
    await grantFolderAccess(path);

    // Bind this folder to the given set (reuse the entry if it's already
    // remembered), then run the shared sync — progress indicator, dedup, abort,
    // and the background import all come for free.
    const existing = (await getSettings()).importFolders?.find((f) => f.path === path);
    const folderId = await upsertImportFolder({
      id: existing?.id,
      path,
      setId,
      displayName: basename(path),
      recursive: existing?.recursive ?? true,
    });
    await runFolderSync([folderId]);
    return true;
  },

  async syncImportFolders() {
    if (!hasFolderAccess()) return;
    const { importFolders } = await getSettings();
    const ids = (importFolders ?? []).map((f) => f.id);
    if (ids.length === 0) return;
    await runFolderSync(ids);
  },

  async deleteSession(sessionId, purgeExclusiveTracks) {
    const wasActive = get().activeSessionId === sessionId;
    const { purgedTrackIds } = await deleteSessionRepo(sessionId, { purgeExclusiveTracks });
    if (wasActive) {
      // Detach the dead set: stop watching it, drop the queue's context (so
      // autoExtend can't fire against it), and clear the active pointer. The
      // play queue itself is left alone — the repo already removed any purged
      // exclusive tracks; songs shared with other sets keep playing. The
      // liveQuery subscription reconciles `queue`/`currentIndex` from that write.
      watchSetForAppend(null, [], true);
      await playQueueSetContext(undefined);
      set({ activeSessionId: null, djEnabled: false, queueSource: undefined });
      await saveSettings({ lastSessionId: undefined });
    }
    return purgedTrackIds.length;
  },

  async draftNow() {
    const { activeSessionId } = get();
    if (!activeSessionId || !djEngine) return;
    set({ isDrafting: true, djError: null });
    try {
      await djEngine.draft(activeSessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ djError: msg });
      log.error("player", "draft failed", msg);
    } finally {
      set({ isDrafting: false });
      void pump(set, get);
    }
  },
}));

// ------------------------------------------------------------ folder import ----

interface IngestResult {
  /** Set when the file was imported. */
  trackId?: string;
  /** Set when the file decoded as media but this WebView can't play it. */
  unsupportedName?: string;
}

async function flushImportedTrackIds(
  setId: string,
  ids: string[],
  afterTrackId?: string,
): Promise<string | undefined> {
  if (ids.length === 0) return afterTrackId;
  const batch = [...ids];
  await insertTrackIdsAfter(setId, batch, afterTrackId);
  ids.length = 0;
  return batch.at(-1) ?? afterTrackId;
}

/**
 * Ingest a single media File into a set: probe → parse metadata → persist.
 * Shared by drag/drop/file-picker uploads and local-folder import. One bad file
 * never throws past here — an undecodable file is reported, not fatal.
 * `sourcePath` carries folder provenance + the dedup key (absent for uploads).
 */
async function ingestMediaFile(
  setId: string,
  file: File,
  sourcePath?: string,
  options: UploadIngestOptions = {},
): Promise<IngestResult> {
  // `.ncm` can't be probed/played encrypted — decrypt in the worker, then pull
  // its cover from the carried CDN URL if no image was embedded.
  if (isNcmFile(file.name)) return ingestNcmFile(setId, file, sourcePath, options);

  const probed = await probeMediaFile(file).catch((err: unknown) => {
    if (!isUnsupportedMediaError(err)) throw err;
    log.warn("player", "skipped unsupported media", {
      fileName: err.fileName,
      mime: err.mime,
      kind: err.kind,
      mediaErrorCode: err.mediaErrorCode,
    });
    return null;
  });
  if (!probed) return { unsupportedName: file.name };

  const parsed = await parseUploadedMediaMetadata(file).catch((err: unknown) => {
    log.warn("player", "media metadata parse failed; falling back to filename metadata", {
      error: err instanceof Error ? err.name : typeof err,
      mime: file.type || probed.mime,
      size: file.size,
    });
    return {
      embeddedCover: undefined,
      mediaMetadata: fallbackUploadMediaMetadata(file, probed.title),
      title: undefined,
      albumPicUrl: undefined,
    };
  });

  const copied = await copyBlobWithProgress(file, { onProgress: options.onCopyProgress });
  const track = await createUploadedTrack({
    sessionId: setId,
    title: parsed.title ?? probed.title,
    kind: probed.kind,
    blob: copied,
    mime: probed.mime,
    durationSec: probed.durationSec,
    mediaMetadata: parsed.mediaMetadata,
    embeddedCover: parsed.embeddedCover,
    sourcePath,
  });
  // Plaintext NetEase export with a "163 key" comment but no embedded art → fetch.
  if (!parsed.embeddedCover && parsed.albumPicUrl) {
    void fetchAndStoreRemoteCover(track.id, parsed.albumPicUrl);
  }
  return { trackId: track.id };
}

/** Decrypt + ingest one `.ncm` (worker), then background-fetch its remote cover. */
async function ingestNcmFile(
  setId: string,
  file: File,
  sourcePath?: string,
  options: UploadIngestOptions = {},
): Promise<IngestResult> {
  const copied = await copyBlobWithProgress(file, { onProgress: options.onCopyProgress });
  const bytes = await copied.arrayBuffer();
  const res = await ingestNcmBytes(setId, file.name, bytes, sourcePath).catch((err: unknown) => {
    log.warn("player", "ncm decode failed", { name: file.name, err: String(err) });
    return null;
  });
  if (!res) return { unsupportedName: file.name };
  if (!res.hasCover && res.albumPicUrl) {
    void fetchAndStoreRemoteCover(res.trackId, res.albumPicUrl);
  }
  return { trackId: res.trackId };
}

async function ingestNcmBytes(
  setId: string,
  name: string,
  bytes: ArrayBuffer,
  sourcePath?: string,
): Promise<ScannedIngestResult> {
  const inputByteLength = bytes.byteLength;
  const input = {
    setId,
    name,
    kind: "audio" as const,
    mime: "",
    sourcePath,
    bytes,
    decode: "ncm" as const,
  };
  if (!shouldPersistDecodedNcmInRenderer()) {
    const result = await ingestViaWorker(input);
    await yieldForImportBackpressure({
      inputBytes: inputByteLength,
      decodedContainer: true,
    });
    return result;
  }
  const decoded = await decodeNcmViaWorker(input);
  const result = await persistDecodedNcmTrack(setId, name, decoded, sourcePath);
  await yieldForImportBackpressure({
    inputBytes: inputByteLength,
    decodedBytes: decoded.audio.byteLength,
    decodedContainer: true,
  });
  return result;
}

async function persistDecodedNcmTrack(
  setId: string,
  name: string,
  decoded: DecodedNcmMedia,
  sourcePath?: string,
): Promise<ScannedIngestResult> {
  const audioBlob = new Blob([new Uint8Array(decoded.audio)], { type: decoded.mime });
  const embeddedCover = decoded.embeddedCover
    ? {
        blob: new Blob([new Uint8Array(decoded.embeddedCover.bytes)], {
          type: decoded.embeddedCover.mime,
        }),
        mime: decoded.embeddedCover.mime,
      }
    : undefined;
  const track = await createUploadedTrack({
    sessionId: setId,
    title: decoded.title,
    kind: "audio",
    blob: audioBlob,
    mime: decoded.mime,
    durationSec: decoded.durationSec,
    mediaMetadata: {
      ...decoded.mediaMetadata,
      originalFileName: decoded.mediaMetadata.originalFileName ?? name,
      originalExtension: decoded.mediaMetadata.originalExtension ?? "ncm",
    },
    embeddedCover,
    sourcePath,
  });
  return {
    trackId: track.id,
    albumPicUrl: decoded.albumPicUrl,
    hasCover: decoded.hasCover,
  };
}

function shouldPersistDecodedNcmInRenderer(): boolean {
  return resolveDesktopBridge().kind === "electron";
}

/**
 * Download a track's remote cover (the `albumPic` URL an `.ncm` carries) and store
 * it as the cover blob. Best-effort + non-blocking: the track is already playable,
 * so a failed/offline fetch just leaves it cover-less; never throws to the caller.
 * Routed through `getAppFetch()` so it bypasses CORS on the desktop shells.
 */
/**
 * Download a streamed track's cover into a blob so it persists (offline) and stops
 * depending on the proxy/referer each render. Goes through the media proxy (which
 * strips the element/localhost Referer hdslb 403s and adds ACAO) — best-effort.
 */
/**
 * Download a streamed track's media into a blob (Phase 5 offline cache): re-resolve
 * with the account, fetch the bytes through the media proxy (Referer injection +
 * CORS), and persist via {@link cacheStreamedTrackBlob}. After this the player's
 * `if (track.blobId)` branch plays it locally, offline. Best-effort + idempotent
 * (no-op if already cached / not streamed). Returns the cache verdict for callers
 * that want to toast.
 */
async function cacheStreamedTrackNow(
  track: Track,
  trace?: PlaybackTraceContext,
): Promise<Awaited<ReturnType<typeof runStreamCache>>> {
  setStreamDownloading(track.id, true);
  try {
    return await runCacheStreamedTrack(track, trace);
  } finally {
    setStreamDownloading(track.id, false);
  }
}

async function runCacheStreamedTrack(
  track: Track,
  trace?: PlaybackTraceContext,
): Promise<Awaited<ReturnType<typeof runStreamCache>>> {
  const settings = await getSettings();
  const http = createStreamHttp();
  const result = await runStreamCache({
    resolve: () =>
      resolveStreamedTrackMedia(track, {
        resolveSource: (id) =>
          createStreamSource(id, {
            http,
            now: () => Date.now(),
            getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
          }),
        getQuality: (id) => settings.streamSources?.[id]?.quality,
        trace,
      }),
    fetchBytes: (url, headers) => fetchStreamMediaBytes(track, url, headers, trace),
    store: (blob, mime) => cacheStreamedTrackBlob(track.id, blob, mime),
    trace: trace ? { ...trace, sourceId: track.streamSourceId } : undefined,
  });
  if (result.kind === "cached") {
    log.info("player", "cached streamed track", { trackId: track.id, bytes: result.bytes });
  } else {
    log.warn("player", "cache streamed track failed", { trackId: track.id, kind: result.kind });
  }
  return result;
}

async function cacheRemoteTrackNow(track: Track): Promise<{ kind: "cached" | "failed" }> {
  setStreamDownloading(track.id, true);
  try {
    const latest = await getTrack(track.id);
    if (!latest || latest.blobId || !latest.remoteMediaUrl) return { kind: "failed" };
    const result = await cacheRemoteTrackMedia(latest.id);
    log.info("player", "cached remote track", {
      trackId: latest.id,
      bytes: result.bytes,
      mime: result.mime,
    });
    return { kind: "cached" };
  } catch (err) {
    log.warn("player", "cache remote track failed", {
      trackId: track.id,
      err: err instanceof Error ? err.message : String(err),
    });
    return { kind: "failed" };
  } finally {
    setStreamDownloading(track.id, false);
  }
}

async function cacheResolvedStreamBlob(
  track: Track,
  resolved: Extract<StreamPlaybackResult, { kind: "ok" }> & { blob: Blob },
  trace?: PlaybackTraceContext,
): Promise<void> {
  if (track.blobId) return;
  setStreamDownloading(track.id, true);
  try {
    const latest = await getTrack(track.id);
    if (!latest || latest.blobId || !isStreamedTrack(latest)) return;
    const result = await runStreamCache({
      resolve: async () => resolved,
      fetchBytes: async () => {
        throw new Error("resolved stream already supplied a blob");
      },
      store: (blob, mime) => cacheStreamedTrackBlob(track.id, blob, mime),
      trace: trace ? { ...trace, sourceId: track.streamSourceId } : undefined,
    });
    if (result.kind === "cached") {
      log.info("player", "cached resolved streamed blob", {
        trackId: track.id,
        source: track.streamSourceId,
        bytes: result.bytes,
      });
    } else {
      log.warn("player", "cache resolved streamed blob failed", {
        trackId: track.id,
        source: track.streamSourceId,
        kind: result.kind,
      });
    }
  } finally {
    setStreamDownloading(track.id, false);
  }
}

/** Max concurrent offline downloads when caching a whole imported playlist — the
 *  same bounded-lane shape as {@link fetchRemoteCovers}, so a big set trickles in
 *  instead of opening hundreds of sockets at once. */
const STREAM_DOWNLOAD_CONCURRENCY = 4;

/**
 * Download every not-yet-cached streamed or remote-R2 track in a set to local blobs (the
 * "download to this device" option on playlist import). Best-effort: each track
 * reports its own spinner via {@link cacheStreamedTrackNow} / {@link cacheRemoteTrackNow};
 * a final toast tallies how many landed vs. failed (VIP/login gates count as failures
 * here). Fire-and-forget — the set is already playable online, so this fills in
 * offline copies.
 */
async function downloadStreamedSetTracks(setId: string): Promise<void> {
  const session = await getSession(setId);
  if (!session) return;
  const rows = await Promise.all(session.trackIds.map((id) => getTrack(id)));
  const pending = rows.filter((t): t is Track => !!t && isTrackCacheableToDevice(t));
  if (pending.length === 0) return;

  setSetBulkDownloading(setId, true);
  let cursor = 0;
  let cached = 0;
  let failed = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const track = pending[cursor];
      cursor += 1;
      if (track.remoteMediaUrl) {
        const result = await cacheRemoteTrackNow(track);
        if (result.kind === "cached") {
          cached += 1;
          void ensureLocalCoverForTrack(track.id);
        } else failed += 1;
      } else if (isStreamedTrack(track)) {
        const result = await cacheStreamedTrackNow(track);
        if (result.kind === "cached") {
          cached += 1;
          void ensureLocalCoverForTrack(track.id);
        } else failed += 1;
      } else {
        failed += 1;
      }
    }
  };
  const lanes = Math.min(STREAM_DOWNLOAD_CONCURRENCY, pending.length);
  try {
    await Promise.all(Array.from({ length: lanes }, () => worker()));
  } finally {
    setSetBulkDownloading(setId, false);
  }

  if (cached > 0) notify.success(i18n.t("streamCache.downloadedMany", { count: cached }));
  if (failed > 0) notify.error(i18n.t("streamCache.downloadFailedMany", { count: failed }));
}

async function fetchAndStoreRemoteCover(trackId: string, url: string): Promise<void> {
  try {
    const appFetch = await getAppFetch();
    const resp = await appFetch(url);
    if (!resp.ok) return;
    const rawBlob = await resp.blob();
    if (rawBlob.size === 0) return;
    const mime =
      resp.headers.get("content-type")?.split(";")[0]?.trim() || rawBlob.type || "image/jpeg";
    if (!mime.startsWith("image/")) return;
    const blob = new Blob([new Uint8Array(await rawBlob.arrayBuffer())], { type: mime });
    await setTrackCover({ trackId, blob, mime });
  } catch (err) {
    log.warn("player", "failed to fetch remote cover", { trackId, err: String(err) });
  }
}

// Module-scope de-dupe so a track's cover is pulled at most once in flight even if
// "download to device" + first-play + a set download all fire for it (not store state —
// CLAUDE.md rule 6).
const localCoverFetchInFlight = new Set<string>();

/**
 * Pull a streamed/remote track's `remoteCoverUrl` into a LOCAL cover blob (+ thumbhash /
 * palette / thumbnail + backlight derivatives) so the backlight glow, gallery thumbnails
 * and clean-texture visual effects work the same as an imported cover — and offline.
 * Best-effort + idempotent: no-op when there's no remote cover, a local cover already
 * exists, a pull is already in flight, or the cross-origin fetch can't reach the bytes
 * (the WEB shell has no `muzfetch://` proxy, so an R2 cover lacking CORS headers stays
 * display-only via the <img> fallback — `setTrackCover` is never reached).
 */
async function ensureLocalCoverForTrack(trackId: string): Promise<void> {
  if (localCoverFetchInFlight.has(trackId)) return;
  const track = await getTrack(trackId);
  if (!track?.remoteCoverUrl || track.coverBlobId) return;
  localCoverFetchInFlight.add(trackId);
  try {
    await fetchAndStoreRemoteCover(trackId, track.remoteCoverUrl);
  } finally {
    localCoverFetchInFlight.delete(trackId);
  }
}

/** Max simultaneous cover downloads during a folder sync (a big NetEase folder can
 *  carry hundreds of `albumPic` URLs — firing them all at once trickles them in out
 *  of order and overwhelms the proxy). Each job still targets its own track. */
const FOLDER_COVER_FETCH_CONCURRENCY = 6;

/**
 * Download the carried `albumPic` covers for a batch of just-imported tracks, with
 * bounded concurrency and honoring the sync's abort signal. The tracks are already
 * playable; covers fill in here, so a cancel stops the remaining downloads instead
 * of letting hundreds of fire-and-forget fetches outlive the run.
 */
async function fetchRemoteCovers(
  jobs: ReadonlyArray<{ trackId: string; url: string }>,
  signal: AbortSignal,
  onProgress?: (done: number) => void,
): Promise<void> {
  let cursor = 0;
  let completed = 0;
  const worker = async () => {
    while (cursor < jobs.length && !signal.aborted) {
      const job = jobs[cursor];
      cursor += 1;
      await fetchAndStoreRemoteCover(job.trackId, job.url);
      completed += 1;
      onProgress?.(completed);
    }
  };
  const lanes = Math.min(FOLDER_COVER_FETCH_CONCURRENCY, jobs.length);
  await Promise.all(Array.from({ length: lanes }, () => worker()));
}

// Guards the read-modify-write of `importFolders` against the boot sync and a
// manual "sync now" overlapping. Module-scope (never selected) → no rerenders.
let folderSyncRunning = false;

/**
 * Re-scan the given remembered folders and import any media not already in the
 * library. Exported so tests can inject a fake {@link FolderFs}; production calls
 * pass none and get the real Tauri-backed shell (which also re-grants read scope
 * per folder, since the static fs scope is empty). Non-reentrant; degrades
 * gracefully — an unreadable folder or one corrupt file never aborts the batch.
 */
export interface FolderSyncResult {
  imported: number;
  encrypted: number;
  decodeFailed: number;
  cancelled: boolean;
}

interface FolderPlan {
  folder: ImportFolder;
  setId: string;
  fresh: ScannedFile[];
}

interface ScannedIngestResult {
  trackId: string;
  hasCover?: boolean;
  albumPicUrl?: string;
}

async function ingestReferencedScannedFile(
  setId: string,
  file: ScannedFile,
): Promise<ScannedIngestResult> {
  const mime = mimeFromExtension(file.name, file.kind);
  const now = Date.now();
  const title = titleFromFileName(file.name);
  const track = await createReferencedUploadedTrack({
    sessionId: setId,
    title,
    kind: file.kind,
    mime,
    durationSec: 0,
    sourcePath: file.path,
    mediaMetadata: {
      originalFileName: file.name,
      originalMime: mime,
      originalExtension: extensionFromFileName(file.name),
      parser: "manual",
      parsedAt: now,
      title,
    },
  });
  return { trackId: track.id, hasCover: false };
}

async function ingestScannedFileBytes(
  setId: string,
  file: ScannedFile,
  fs: Pick<FolderFs, "readFile">,
): Promise<ScannedIngestResult> {
  // Read on the main thread (async IPC/plugin — off the CPU), then hand the bytes
  // to the worker for the heavy parse/decrypt + DB write (no UI jank).
  const bytes = await fs.readFile(file.path);
  const inputBytes = arrayBufferFromBytes(bytes);
  const inputByteLength = inputBytes.byteLength;
  if (file.decode === "ncm") {
    return ingestNcmBytes(setId, file.name, inputBytes, file.path);
  }
  const result = await ingestViaWorker({
    setId,
    name: file.name,
    kind: file.kind,
    mime: mimeFromExtension(file.name, file.kind),
    sourcePath: file.path,
    bytes: inputBytes,
  });
  await yieldForImportBackpressure({ inputBytes: inputByteLength });
  return result;
}

function arrayBufferFromBytes(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim() || name;
}

function extensionFromFileName(name: string): string | undefined {
  return name.toLowerCase().match(/\.([^.]+)$/)?.[1];
}

/**
 * Scan the given remembered folders and import any media not already in the
 * library. Two passes — scan + dedup all folders first (so the total is known),
 * then import — so progress is meaningful and the run is cancelable between files
 * (mirrors the R2 orchestrator's between-objects model; an in-flight file isn't
 * interrupted). Emits live progress to {@link useFolderImportStore}; the sync
 * indicator turns that into a persistent, cancelable toast. Returns counts so
 * callers/tests can assert without spying on notifications.
 */
export async function runFolderSync(
  folderIds: string[],
  fsOverride?: FolderFs,
): Promise<FolderSyncResult> {
  if (folderSyncRunning) return { imported: 0, encrypted: 0, decodeFailed: 0, cancelled: false };
  folderSyncRunning = true;
  const signal = beginFolderImport();
  usePlayerStore.setState({ isUploading: true });
  const useRealShell = !fsOverride;
  let imported = 0;
  let encrypted = 0;
  // Plaintext media defers its codec check to first play (never decode-fails here);
  // `.ncm` can fail to decrypt, so this is bumped in the import loop's catch.
  let decodeFailed = 0;
  setFolderImportProgress({
    phase: "scanning",
    done: 0,
    total: 0,
    imported,
    encrypted,
    decodeFailed,
  });
  try {
    const fs = fsOverride ?? createFolderFs();
    const referencePlaintextLocalFiles = useRealShell && resolveDesktopBridge().kind === "electron";

    // Pass 1 — scan + dedup each folder, recreating a deleted bound set as needed.
    const plans: FolderPlan[] = [];
    for (const folderId of folderIds) {
      if (signal.aborted) break;
      const folder = (await getSettings()).importFolders?.find((f) => f.id === folderId);
      if (!folder) continue;
      if (useRealShell) await grantFolderAccess(folder.path);

      let setId = folder.setId;
      if (!(await getSession(setId))) {
        const session = await createSession({
          name: folder.displayName ?? basename(folder.path),
          seedPrompt: "",
          config: { autoExtend: false },
          displayMode: "video",
        });
        setId = session.id;
        await upsertImportFolder({ ...folder, setId });
      }

      const scan = await scanFolderForMedia(folder.path, fs, {
        recursive: folder.recursive ?? true,
      }).catch((err: unknown) => {
        log.warn("player", "folder scan failed", { path: folder.path, err: String(err) });
        return null;
      });
      if (!scan) continue;
      encrypted += scan.encryptedCount;
      if (scan.unsupportedCount > 0) {
        log.debug("player", "folder scan skipped non-media files", {
          path: folder.path,
          count: scan.unsupportedCount,
        });
      }
      const known = await knownSourcePaths(scan.media.map((m) => m.path));
      plans.push({ folder: { ...folder, setId }, setId, fresh: selectNewFiles(scan.media, known) });
    }

    // Pass 2 — import, emitting cumulative progress.
    const total = plans.reduce((n, p) => n + p.fresh.length, 0);
    let done = 0;
    // Carried-cover URLs to pull AFTER the audio is in (bounded, below) — each keyed
    // to its own track, so order of completion never reassigns a cover.
    const coverJobs: Array<{ trackId: string; url: string }> = [];
    setFolderImportProgress({ phase: "importing", done, total, imported, encrypted, decodeFailed });
    for (const plan of plans) {
      const ids: string[] = [];
      let planImported = 0;
      let lastPublishedTrackId: string | undefined;
      for (const file of plan.fresh) {
        if (signal.aborted) break;
        try {
          const res =
            referencePlaintextLocalFiles && !file.decode
              ? await ingestReferencedScannedFile(plan.setId, file)
              : await ingestScannedFileBytes(plan.setId, file, fs);
          ids.push(res.trackId);
          planImported += 1;
          imported += 1;
          if (ids.length >= IMPORT_VISIBILITY_FLUSH_SIZE) {
            lastPublishedTrackId = await flushImportedTrackIds(
              plan.setId,
              ids,
              lastPublishedTrackId,
            );
          }
          // No embedded image but a carried cover URL (`.ncm`, or a plaintext mp3
          // with a NetEase "163 key" comment) → queue it for the bounded fetch pass.
          if (!res.hasCover && res.albumPicUrl) {
            coverJobs.push({ trackId: res.trackId, url: res.albumPicUrl });
          }
        } catch (err) {
          // One unreadable/corrupt file must not abort the batch.
          if (file.decode === "ncm") decodeFailed += 1;
          log.warn("player", "failed to import folder file", { path: file.path, err: String(err) });
        }
        done += 1;
        setFolderImportProgress({
          phase: "importing",
          done,
          total,
          imported,
          encrypted,
          decodeFailed,
          currentName: file.name,
        });
      }
      lastPublishedTrackId = await flushImportedTrackIds(plan.setId, ids, lastPublishedTrackId);
      await upsertImportFolder({
        ...plan.folder,
        setId: plan.setId,
        lastScanAt: Date.now(),
        lastImportedCount: planImported,
      });
      if (signal.aborted) break;
    }

    // Covers come from a CDN — fetch them bounded + abortable so a large folder
    // doesn't fire hundreds of concurrent downloads. Audio is already imported, so
    // tracks play immediately; this only fills in the artwork. Its own progress
    // phase keeps the indicator honest instead of sitting at "done/total".
    if (coverJobs.length > 0 && !signal.aborted) {
      const coverTotal = coverJobs.length;
      const emitCovers = (coverDone: number) =>
        setFolderImportProgress({
          phase: "covers",
          done,
          total,
          imported,
          encrypted,
          decodeFailed,
          coverDone,
          coverTotal,
        });
      emitCovers(0);
      await fetchRemoteCovers(coverJobs, signal, emitCovers);
    }

    const cancelled = signal.aborted;
    setFolderImportProgress({
      phase: cancelled ? "cancelled" : "completed",
      done,
      total,
      imported,
      encrypted,
      decodeFailed,
    });
    log.info(
      "player",
      `folder sync imported ${imported} file(s)${cancelled ? " (cancelled)" : ""}`,
    );
    return { imported, encrypted, decodeFailed, cancelled };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    usePlayerStore.setState({ djError: msg });
    setFolderImportProgress(null);
    log.error("player", "folder sync failed", msg);
    return { imported, encrypted, decodeFailed, cancelled: signal.aborted };
  } finally {
    folderSyncRunning = false;
    endFolderImport();
    usePlayerStore.setState({ isUploading: false });
  }
}

// --------------------------------------------------------------- internals ----

// HTMLMediaElement.error.code → a short, non-localized technical label. This is
// debug detail (shown in the toast + copy payload), not user-facing copy, so it
// stays in English alongside the code.
const MEDIA_ERROR_LABELS: Record<number, string> = {
  1: "MEDIA_ERR_ABORTED",
  2: "MEDIA_ERR_NETWORK",
  3: "MEDIA_ERR_DECODE",
  4: "MEDIA_ERR_SRC_NOT_SUPPORTED",
};

/** Compact technical descriptor for a playback failure (MediaError or Error). */
function describePlaybackError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = Number((error as MediaError).code);
    const label = MEDIA_ERROR_LABELS[code] ?? `code ${code}`;
    const message = (error as MediaError).message?.trim();
    return message ? `${label}: ${message}` : label;
  }
  if (error instanceof Error) return error.message;
  return error ? String(error) : "unknown";
}

async function fetchRemotePlaybackBlob(
  track: Track,
  trace: PlaybackTraceContext | undefined,
  signal?: AbortSignal,
): Promise<{ blob: Blob; bytes: number; mime: string }> {
  const url = track.remoteMediaUrl;
  if (!url) throw new Error("Track has no remote media URL");

  tracePlaybackLoad("media.fetch.remote", track, trace, {
    transport: "remote",
    ...streamUrlTraceContext(url),
  });
  const fetcher = await getAppFetch();
  const response = await fetcher(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`Remote playback fetch failed: HTTP ${response.status}`);

  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Remote playback fetch returned an empty file");
  const mime = response.headers.get("content-type") ?? blob.type ?? "application/octet-stream";
  tracePlaybackLoad("media.load.remote.blob", track, trace, {
    transport: "blob",
    bytes: blob.size,
    mime,
    ...streamUrlTraceContext(url),
  });
  return { blob, bytes: blob.size, mime };
}

async function readRemotePlaybackCache(
  track: Track,
  trace: PlaybackTraceContext | undefined,
): Promise<{ blob: Blob; bytes: number; mime: string } | null> {
  try {
    const cached = await getCachedRemotePlayback(track);
    if (!cached) return null;
    tracePlaybackLoad("media.load.remote.cache", track, trace, {
      transport: "blob",
      bytes: cached.bytes,
      mime: cached.mime,
      ...streamUrlTraceContext(cached.sourceUrl),
    });
    return { blob: cached.blob, bytes: cached.bytes, mime: cached.mime };
  } catch (error) {
    log.warn("player", "remote playback cache read failed", {
      trackId: track.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeRemotePlaybackCache(
  track: Track,
  media: { blob: Blob; bytes: number; mime: string },
): Promise<void> {
  try {
    const settings = await getSettings();
    await putRemotePlaybackCache(track, media, { maxBytes: playbackCacheLimitBytes(settings) });
  } catch (error) {
    log.warn("player", "remote playback cache write failed", {
      trackId: track.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function persistQueueIndex(index: number): void {
  if (index === lastPersistedQueueIndex && queueCursorPersistTimer == null) return;
  queueCursorPersistSeq += 1;
  const seq = queueCursorPersistSeq;
  if (queueCursorPersistTimer != null) {
    window.clearTimeout(queueCursorPersistTimer);
  }
  queueCursorPersistTimer = window.setTimeout(() => {
    queueCursorPersistTimer = null;
    if (seq !== queueCursorPersistSeq || index === lastPersistedQueueIndex) return;
    lastPersistedQueueIndex = index;
    void playQueueSetIndex(index).catch((error: unknown) => {
      log.warn("player", "failed to persist play queue cursor", error);
    });
  }, QUEUE_CURSOR_PERSIST_DEBOUNCE_MS);
}

function watchSetForAppend(
  sessionId: string | null,
  seedConsumedTrackIds: Iterable<string>,
  force = false,
): void {
  if (!force && setSubSessionId === sessionId) return;
  setSub?.unsubscribe();
  setSub = null;
  setSubSessionId = sessionId;
  consumedTrackIds = new Set(seedConsumedTrackIds);
  if (!sessionId) return;

  // Watch the active 歌单: append its newly-added tracks (DJ refill / uploads)
  // onto the queue, by high-water mark so user-removed tracks don't come back.
  setSub = liveQuery(() => getSession(sessionId)).subscribe({
    next: (s) => {
      if (!s) return;
      const fresh = unconsumedTrackIds(s.trackIds, consumedTrackIds);
      if (fresh.length === 0) return;
      for (const id of fresh) consumedTrackIds.add(id);
      void playQueueAppend(fresh);
    },
    error: (err) => log.error("player", "set subscription error", err),
  });
}

async function hydratePlaybackSettings(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  if (playbackSettingsLoaded) return;
  playbackSettingsLoaded = true;
  const settings = await getSettings();
  const repeat = settings.playerRepeatMode ?? "all";
  const shuffle = settings.playerShuffle ?? false;
  const volume = clampVolume(settings.playerVolume);
  set({ repeat, shuffle, volume });
  mediaEngine?.setVolume(volume);
  shuffleOrder = shuffle ? buildShuffleOrder(get().queue.length, get().currentIndex) : [];
}

function clampVolume(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_PLAYER_VOLUME;
  return Math.min(1, Math.max(0, value));
}

/**
 * Fire-and-forget LRCLIB auto-fetch for the now-current track. Module scope (not
 * store state) so per-frame playback never re-renders on it (rule 6). Aborts any
 * in-flight fetch when the track changes; generated tracks use brief.lyrics and
 * skip the network. All eligibility checks live in runAutoFetchLyrics.
 */
function triggerLyricsAutoFetch(track: Track): void {
  // Cancel any in-flight fetch + pending debounce from the previous track.
  lyricsAbort?.abort();
  if (lyricsTimer !== null) clearTimeout(lyricsTimer);
  lyricsTimer = null;
  if (track.origin === "generated") return;
  const controller = new AbortController();
  lyricsAbort = controller;
  // Debounce: only fetch once the user settles on a track, so rapid skipping
  // never piles up requests. Always fire-and-forget — never blocks the switch.
  lyricsTimer = setTimeout(() => {
    lyricsTimer = null;
    if (controller.signal.aborted) return;
    void (async () => {
      try {
        const settings = await getSettings();
        await runAutoFetchLyrics({
          track,
          settings,
          provider: resolveLyricsProviderForTrack(settings, track),
          signal: controller.signal,
        });
      } catch (err) {
        log.warn("lyrics", "auto-fetch trigger failed", err);
      }
    })();
  }, 350);
}

/** Poll the live queue for a track id — the set watcher appends newly-added tracks async. */
async function waitForQueueIndex(
  get: () => PlayerState,
  trackId: string,
  tries = 40,
): Promise<number | null> {
  for (let i = 0; i < tries; i += 1) {
    const idx = get().queue.findIndex((t) => t.id === trackId);
    if (idx >= 0) return idx;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const idx = get().queue.findIndex((t) => t.id === trackId);
  return idx >= 0 ? idx : null;
}

/** Wait until the queue slot at `index` holds `trackId` (the play-now cut-in landed). */
async function waitForQueueSlot(
  get: () => PlayerState,
  index: number,
  trackId: string,
  tries = 40,
): Promise<boolean> {
  for (let i = 0; i < tries; i += 1) {
    if (get().queue[index]?.id === trackId) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return get().queue[index]?.id === trackId;
}

async function ensureTrackInCurrentPlayQueue(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
  trackId: string,
): Promise<number> {
  const stateIndex = get().queue.findIndex((t) => t.id === trackId);
  if (stateIndex >= 0) return stateIndex;

  consumedTrackIds.add(trackId);
  let pq = await getPlayQueue();
  if (!pq.entries.some((entry) => entry.trackId === trackId)) {
    pq = await playQueuePlayNext([trackId]);
  }
  const trackIds = pq.entries.map((entry) => entry.trackId);
  const queue = await getTracksByIds(trackIds);
  const idx = queue.findIndex((track) => track.id === trackId);
  if (idx >= 0) {
    lastQueueSig = queueSig(queue);
    set({ queue });
  }
  return idx;
}

/** Get (or lazily create + remember) the set that collects online-source songs. */
/** Resolve a source playlist to its full hit list (the cookie-authed eapi/WBI path). */
async function fetchPlaylistHits(
  sourceId: StreamSourceId,
  playlistId: string,
): Promise<StreamSearchHit[]> {
  const settings = await getSettings();
  const source = createStreamSource(sourceId, {
    http: createStreamHttp(),
    now: () => Date.now(),
    getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
  });
  return (await source?.importPlaylist?.(playlistId)) ?? [];
}

async function ensureOnlineSet(): Promise<string> {
  const settings = await getSettings();
  if (settings.streamOnlineSetId) {
    const existing = await getSession(settings.streamOnlineSetId);
    if (existing) return existing.id;
  }
  const session = await createSession({
    name: i18n.t("globalSearch.onlineSetName"),
    seedPrompt: "",
    config: { autoExtend: false },
  });
  await saveSettings({ streamOnlineSetId: session.id });
  return session.id;
}

async function ensureLoadedAndPlay(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
  requestId?: number,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  log.debug("player", "ensureLoadedAndPlay", { currentIndex, queueLength: queue.length, wantPlay });
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  const track = queue[currentIndex];
  if (!mediaEngine) return;
  let activeRequestId = requestId;
  const continueCurrent = (stage: string) =>
    shouldContinuePlaybackCursor(get, track, activeRequestId, stage);
  if (!continueCurrent("start")) return;
  const playbackTrace = ensurePlaybackTrace(track, wantPlay);
  mediaEngine.setDiagnosticsContext(playbackTrace);
  // Local-first priority: blob (downloaded/offline) → local-file → remoteMediaUrl → stream.
  const sourceKind = playbackSourceKind(track);
  if (track.status !== "ready" || sourceKind === "none") {
    log.debug("player", "track is not playable yet", {
      trackId: track.id,
      status: track.status,
      hasBlob: !!track.blobId,
      hasRemoteMedia: !!track.remoteMediaUrl,
    });
    void pump(set, get);
    return;
  }
  if (MEDIA_SOURCE_RELOAD_BISECT_MODE !== "off") {
    if (
      (MEDIA_SOURCE_RELOAD_BISECT_MODE === "read" ||
        MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-no-play" ||
        MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-and-play" ||
        MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session" ||
        MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session-settled") &&
      sourceKind === "blob"
    ) {
      const media = await getTrackBlob(track);
      if (!continueCurrent("diag-blob-read")) return;
      if (media?.blob) {
        const event =
          MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session-settled"
            ? "media.load.attach-play-media-session-settled"
            : MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session"
              ? "media.load.attach-play-media-session"
              : MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-and-play"
                ? "media.load.attach-play"
                : MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-no-play"
                  ? "media.load.attach-only"
                  : "media.load.read-only";
        tracePlaybackLoad(event, track, playbackTrace, {
          bytes: media.bytes,
          mime: media.mime,
          sourceId: "diag-bisect:blob-read",
          transport: "blob",
        });
        if (
          MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-no-play" ||
          MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-and-play" ||
          MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session" ||
          MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session-settled"
        ) {
          await mediaEngine.loadBlob(media.blob, track.kind);
          if (!continueCurrent("diag-blob-attached")) return;
        }
        if (
          (MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-and-play" ||
            MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session" ||
            MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session-settled") &&
          wantPlay &&
          get().wantPlay
        ) {
          playbackLog.info("play.requested", {
            message: "media play requested",
            ...playbackTrace,
            category: "media",
            phase: "start",
          });
          await mediaEngine.play();
          if (!continueCurrent("diag-after-play")) return;
        }
      } else {
        tracePlaybackLoad("media.load.skip", track, playbackTrace, {
          sourceId: "diag-bisect:blob-missing",
          transport: "blob",
        });
      }
    } else {
      tracePlaybackLoad("media.load.skip", track, playbackTrace, {
        sourceId: `diag-bisect:${sourceKind}`,
        transport: "blob",
      });
    }
    loadedTrackId = track.id;
    const duration = playableDurationSec(track.durationSec);
    set({
      durationSec: duration || get().durationSec,
      isPlaying: wantPlay,
      positionSec: 0,
    });
    if (MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session") {
      void updateMediaSessionMetadata(track, () => continueCurrent("diag-media-session"));
    } else if (MEDIA_SOURCE_RELOAD_BISECT_MODE === "attach-play-media-session-settled") {
      scheduleMediaSessionMetadata(track, () => continueCurrent("diag-media-session-settled"));
    }
    return;
  }
  const previousLoadedTrackId = loadedTrackId;
  if (loadedTrackId !== track.id) {
    flushPlaybackListen(Date.now());
    if (sourceKind === "blob") {
      // Cached/downloaded bytes — plays locally, offline, no network round-trip.
      if (previousLoadedTrackId !== null && activeRequestId !== undefined) {
        await delay(LOCAL_BLOB_PLAYBACK_SETTLE_MS);
        if (!continueCurrent("blob-settled")) return;
      }
      const media = await getTrackBlob(track);
      if (!continueCurrent("blob-resolved")) return;
      if (!media) {
        log.warn("player", "missing media blob", { trackId: track.id, blobId: track.blobId });
        return;
      }
      log.debug("player", "loading media blob", {
        trackId: track.id,
        kind: track.kind,
        mime: media.mime,
        bytes: media.bytes,
      });
      tracePlaybackLoad("media.load.blob", track, playbackTrace, {
        bytes: media.bytes,
        mime: media.mime,
        transport: "blob",
      });
      if (!media.blob) {
        notify.error(i18n.t("player.playbackError"));
        log.warn("player", "local media blob missing inline bytes", {
          trackId: track.id,
          blobId: track.blobId,
        });
        set({ isPlaying: false, wantPlay: false });
        return;
      }
      await mediaEngine.loadBlob(media.blob, track.kind);
      if (!continueCurrent("blob-loaded")) return;
    } else if (sourceKind === "local-file") {
      const bridge = resolveDesktopBridge();
      if (!track.sourcePath || !bridge.localMediaUrl) {
        notify.error(i18n.t("player.playbackError"));
        log.warn("player", "local-file playback is unavailable", {
          trackId: track.id,
          hasSourcePath: !!track.sourcePath,
          bridge: bridge.kind,
        });
        set({ isPlaying: false, wantPlay: false });
        return;
      }
      const mime =
        track.mediaMetadata?.originalMime ?? (track.kind === "video" ? "video/mp4" : "audio/mpeg");
      const src = await bridge.localMediaUrl({
        path: track.sourcePath,
        mime,
        trace: playbackTrace,
      });
      if (!continueCurrent("local-file-url")) return;
      tracePlaybackLoad("media.load.local-file", track, playbackTrace, {
        mime,
        transport: "local-file",
      });
      await mediaEngine.loadUrl(src, track.kind, { crossOrigin: "anonymous" });
      if (!continueCurrent("local-file-loaded")) return;
    } else if (sourceKind === "remote") {
      log.debug("player", "loading remote media url", {
        trackId: track.id,
        kind: track.kind,
      });
      const cached = await readRemotePlaybackCache(track, playbackTrace);
      if (!continueCurrent("remote-cache")) return;
      if (cached) {
        await mediaEngine.loadBlob(cached.blob, track.kind);
        if (!continueCurrent("remote-cache-loaded")) return;
      } else {
        const request = beginPlaybackLoading(set, track, sourceKind);
        activeRequestId = request.id;
        try {
          const media = await fetchRemotePlaybackBlob(
            track,
            playbackTrace,
            request.controller.signal,
          );
          if (!continueCurrent("remote-fetched")) return;
          await mediaEngine.loadBlob(media.blob, track.kind);
          if (!continueCurrent("remote-loaded")) return;
          void writeRemotePlaybackCache(track, media);
        } catch (error) {
          if (isAbortError(error) || !continueCurrent("remote-failed")) return;
          notify.error(i18n.t("player.playbackError"), {
            detail: describePlaybackError(error),
            error,
          });
          log.warn("player", "remote media playback fetch failed", {
            trackId: track.id,
            error,
          });
          set({ isPlaying: false, wantPlay: false });
          return;
        } finally {
          clearPlaybackLoading(set, request.id);
        }
      }
    } else if (sourceKind === "stream") {
      // External streaming source: resolve a short-lived URL right before play.
      // NetEase plays directly; Bilibili's URL needs the media proxy to inject a
      // Referer (returned in `headers`, wired once the proxy lands) — until then a
      // bili stream loads but the CDN GET 403s.
      const settings = await getSettings();
      if (!continueCurrent("stream-settings")) return;
      const http = createStreamHttp();
      const resolved = await resolveStreamedTrackMedia(track, {
        resolveSource: (id) =>
          createStreamSource(id, {
            http,
            now: () => Date.now(),
            getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
          }),
        getQuality: (id) => settings.streamSources?.[id]?.quality,
        trace: playbackTrace ? { ...playbackTrace, sourceId: track.streamSourceId } : undefined,
      });
      if (!continueCurrent("stream-resolved")) return;
      if (resolved.kind !== "ok") {
        log.warn("player", "streamed resolve failed", { trackId: track.id, result: resolved });
        // A VIP/members-only or login-gated track isn't a generic error — tell the user
        // they need to log into that source.
        const needsAccess =
          resolved.kind === "requires-login" ||
          (resolved.kind === "no-permission" && resolved.reason === "vip");
        const notificationLevel = streamResolveFailureNotificationLevel(track, needsAccess);
        // Auto-skip past un-streamable songs (common in imported playlists: VIP /
        // 付费 / 下架 tracks the account can't play) so the rest of the set still
        // plays through, instead of halting on the first gap. Routed through the
        // SAME `next()` a user/transport triggers — so the cover transition, repeat
        // / shuffle, and presence all behave identically (no bespoke skip path that
        // drifts out of sync). The id set bounds the run so a queue full of gaps
        // stops after one pass instead of looping through repeat-all/repeat-one.
        const { wantPlay: stillWants } = get();
        const skipDecision = recordStreamSkipFailure(
          streamSkipRunTrackIds,
          track.id,
          get().queue.length,
          MAX_STREAM_SKIP_RUN,
        );
        streamSkipRunTrackIds = skipDecision.failedTrackIds;
        if (skipDecision.firstFailureInRun) {
          // One toast per skip-run, so a playlist full of gaps doesn't spam.
          const title = i18n.t(
            needsAccess || isCloudMetadataOnlyStreamTrack(track)
              ? "player.streamNeedsAccess"
              : "player.playbackError",
          );
          if (notificationLevel === "warning") notify.warning(title);
          else notify.error(title);
        }
        if (stillWants && skipDecision.shouldTryNext) {
          await get().next(); // unified switch; recurses here if the next is also unplayable
          return;
        }
        // Paused, or scanned the whole queue with nothing playable → give up cleanly.
        streamSkipRunTrackIds = new Set();
        get().pause();
        set({ isPlaying: false });
        return;
      }
      // Bilibili's CDN GET needs a Referer the <audio> element can't set, so route it
      // through the media proxy (Electron). NetEase URLs play directly. Falls back to
      // the raw URL when the shell has no media proxy (web/tauri).
      const bridge = resolveDesktopBridge();
      const mediaTrace = streamMediaTrace(track, playbackTrace);
      // Blob transport carries no url (PRD F-1) — the proxy/direct paths only
      // apply when the resolver handed back a CDN url.
      const resolvedUrl = resolved.url;
      const proxiedUrl =
        resolved.headers && bridge.mediaProxyUrl && resolvedUrl
          ? bridge.mediaProxyUrl(resolvedUrl, resolved.headers, mediaTrace)
          : null;
      const src = proxiedUrl ?? resolvedUrl;
      tracePlaybackLoad("media.load.stream", track, playbackTrace, {
        transport: resolved.blob ? "blob" : proxiedUrl ? "media-proxy" : "direct",
        sourceId: track.streamSourceId,
        proxied: proxiedUrl !== null,
        ...(resolvedUrl ? streamUrlTraceContext(resolvedUrl) : null),
      });
      log.debug("player", "loading streamed media url", {
        trackId: track.id,
        source: track.streamSourceId,
        proxied: proxiedUrl !== null,
        downloadedBlob: Boolean(resolved.blob),
      });
      // Download-before-play (default): pull the whole song to a local blob so it's
      // byte-range seekable — scrubber / Dock-drag / lyric-seek work from the first
      // second (a proxied stream is not seekable) — and cached offline. YouTube already
      // hands back a blob; other sources resolve to a short-lived URL we download here.
      // A download failure degrades to plain streaming so playback still starts.
      let resolvedBlob = resolved.blob ?? null;
      if (!resolvedBlob && resolvedUrl) {
        // Spin the Dock cover (playbackLoading) + the queue-row download indicator
        // (setStreamDownloading) for the multi-second download so it doesn't look frozen.
        const request = beginPlaybackLoading(set, track, sourceKind);
        activeRequestId = request.id;
        setStreamDownloading(track.id, true);
        try {
          resolvedBlob = await downloadStreamForPlayback(
            track,
            resolvedUrl,
            resolved.headers,
            playbackTrace,
          );
        } finally {
          setStreamDownloading(track.id, false);
          clearPlaybackLoading(set, request.id);
        }
        if (!continueCurrent("stream-download")) {
          // The bytes are paid for — cache them for next time even though this track is
          // no longer active, then bail out of the now-stale load.
          if (resolvedBlob)
            void cacheResolvedStreamBlob(track, { ...resolved, blob: resolvedBlob }, playbackTrace);
          return;
        }
      }
      if (resolvedBlob) {
        await mediaEngine.loadBlob(resolvedBlob, track.kind);
        if (!continueCurrent("stream-blob-loaded")) return;
        // Persist so the next play is local-first (no re-resolve / re-download).
        void cacheResolvedStreamBlob(track, { ...resolved, blob: resolvedBlob }, playbackTrace);
      } else if (src) {
        // Download failed (or this shell has no media proxy) — stream instead. Proxied
        // responses send ACAO:* so opt into CORS, else the WebAudio graph taints (and
        // silences) the audio.
        await mediaEngine.loadUrl(
          src,
          track.kind,
          proxiedUrl ? { crossOrigin: "anonymous" } : undefined,
        );
        if (!continueCurrent("stream-url-loaded")) return;
      } else {
        // Contract violation — an ok resolve always carries one of blob/url.
        notify.error(i18n.t("player.playbackError"));
        log.warn("player", "streamed resolve returned neither blob nor url", {
          trackId: track.id,
          source: track.streamSourceId,
        });
        set({ isPlaying: false, wantPlay: false });
        return;
      }
      // Background auto-cache only matters if we ended up streaming (no local blob yet).
      if (settings.autoCacheStreamed && !track.blobId && !resolvedBlob)
        void cacheStreamedTrackNow(track, playbackTrace);
    }
    if (!continueCurrent("before-loaded-state")) return;
    loadedTrackId = track.id;
    streamSkipRunTrackIds = new Set(); // a track loaded — end any streamed-skip run cleanly
    const requestedPosition = Math.max(0, get().positionSec);
    const duration =
      playableDurationSec(get().durationSec) || playableDurationSec(track.durationSec);
    if (requestedPosition > 0) {
      const seekPosition = duration > 0 ? Math.min(duration, requestedPosition) : requestedPosition;
      mediaEngine.seek(seekPosition);
      set({ positionSec: seekPosition, durationSec: duration || get().durationSec });
    } else if (duration > 0 && get().durationSec <= 0) {
      set({ durationSec: duration });
    }
    triggerLyricsAutoFetch(track);
    // When auto-caching streamed content is on, also pull this track's remote cover into
    // a local blob on first play — so the backlight / palette / clean-texture effects get
    // CORS-clean bytes (and offline art) without an explicit "download to device". Tiny,
    // fire-and-forget, idempotent. Explicit download covers the opt-out case. `settings`
    // isn't in scope here, so read it lazily and only when there's a remote cover to pull.
    if (track.remoteCoverUrl && !track.coverBlobId) {
      void getSettings().then((s) => {
        if (s.autoCacheStreamed) void ensureLocalCoverForTrack(track.id);
      });
    }
    if (!continueCurrent("before-metadata")) return;
    await updateMediaSessionMetadata(
      track,
      () => currentTrack(get())?.id === track.id && isPlaybackRequestSeqCurrent(activeRequestId),
    );
    if (!continueCurrent("metadata-updated")) return;
  }
  if (wantPlay && get().wantPlay) {
    if (!continueCurrent("before-play")) return;
    log.debug("player", "playing media", { trackId: track.id });
    playbackLog.info("play.requested", {
      message: "media play requested",
      ...playbackTrace,
      category: "media",
      phase: "start",
    });
    await mediaEngine.play();
    if (!continueCurrent("after-play")) return;
    void publishPlaybackPresence(
      previousLoadedTrackId == null
        ? "trackStarted"
        : previousLoadedTrackId === track.id
          ? "resumed"
          : "trackChanged",
      get(),
    );
  }
}

async function updateMediaSessionMetadata(
  track: Track,
  isCurrent: () => boolean = () => loadedTrackId === track.id,
): Promise<void> {
  const startedAt = performance.now();
  const baseTrace = {
    trackId: track.id,
    coverBlobId: track.coverBlobId,
    hasRemoteCover: Boolean(track.remoteCoverUrl),
  };
  const finish = (phase: string, data?: Record<string, unknown>) =>
    notePerfWork("player.mediaSession.metadata", performance.now() - startedAt, {
      ...baseTrace,
      phase,
      ...(data ?? {}),
    });

  if (!canSetPlatformMediaSessionMetadata()) {
    revokeMediaSessionArtworkObjectUrl();
    finish("skip", { reason: "unsupported" });
    return;
  }

  // Sequence the async cover fetches: an older call finishing late must discard
  // its own URL, not revoke the newer one already handed to the media session
  // (PRD F-12).
  const seq = ++mediaSessionMetadataSeq;
  let nextArtworkObjectUrl: string | null = null;
  let artwork:
    | {
        src: string;
        mime?: string;
      }
    | undefined;
  if (track.remoteCoverUrl) {
    artwork = { src: track.remoteCoverUrl };
  } else if (track.coverBlobId) {
    if (!isCurrent()) {
      finish("skip", { reason: "stale-before-cover" });
      return;
    }
    const coverStartedAt = performance.now();
    const cover = await getTrackCover(track);
    notePerfWork("player.mediaSession.artwork.fetch", performance.now() - coverStartedAt, {
      ...baseTrace,
      hasBlob: Boolean(cover?.blob),
      bytes: cover?.blob?.size ?? 0,
      mime: cover?.mime,
    });
    if (!isCurrent()) {
      finish("skip", { reason: "stale-after-cover", hasCoverBlob: Boolean(cover?.blob) });
      return;
    }
    if (cover?.blob) {
      const objectUrlStartedAt = performance.now();
      nextArtworkObjectUrl = URL.createObjectURL(cover.blob);
      notePerfWork(
        "player.mediaSession.artwork.objectUrl",
        performance.now() - objectUrlStartedAt,
        {
          ...baseTrace,
          bytes: cover.blob.size,
          mime: cover.mime,
        },
      );
      artwork = { src: nextArtworkObjectUrl, mime: cover.mime };
    }
  }

  if (!isCurrent() || loadedTrackId !== track.id || seq !== mediaSessionMetadataSeq) {
    if (nextArtworkObjectUrl) URL.revokeObjectURL(nextArtworkObjectUrl);
    finish("skip", {
      reason: "stale-final",
      hasArtwork: Boolean(artwork?.src),
      seq,
      currentSeq: mediaSessionMetadataSeq,
    });
    return;
  }

  const setStartedAt = performance.now();
  const didSet = setPlatformMediaSessionMetadata(track, artwork);
  notePerfWork("player.mediaSession.metadata.set", performance.now() - setStartedAt, {
    ...baseTrace,
    didSet,
    hasArtwork: Boolean(artwork?.src),
  });
  if (mediaSessionArtworkObjectUrl && mediaSessionArtworkObjectUrl !== nextArtworkObjectUrl) {
    URL.revokeObjectURL(mediaSessionArtworkObjectUrl);
  }
  mediaSessionArtworkObjectUrl = nextArtworkObjectUrl;
  finish("success", { didSet, hasArtwork: Boolean(artwork?.src) });
}

function scheduleMediaSessionMetadata(
  track: Track,
  isCurrent: () => boolean,
  delayMs = MEDIA_SESSION_METADATA_SETTLE_MS,
): void {
  if (mediaSessionMetadataTimer !== null) {
    clearTimeout(mediaSessionMetadataTimer);
    mediaSessionMetadataTimer = null;
  }
  const seq = ++mediaSessionMetadataScheduleSeq;
  mediaSessionLog.debug("metadata.schedule", {
    category: "performance",
    phase: "start",
    trackId: track.id,
    coverBlobId: track.coverBlobId,
    delayMs,
  });
  mediaSessionMetadataTimer = setTimeout(() => {
    mediaSessionMetadataTimer = null;
    if (seq !== mediaSessionMetadataScheduleSeq || !isCurrent()) {
      mediaSessionLog.debug("metadata.schedule", {
        category: "performance",
        phase: "skip",
        reason: "stale",
        trackId: track.id,
        coverBlobId: track.coverBlobId,
        delayMs,
      });
      return;
    }
    mediaSessionLog.debug("metadata.schedule", {
      category: "performance",
      phase: "success",
      trackId: track.id,
      coverBlobId: track.coverBlobId,
      delayMs,
    });
    void updateMediaSessionMetadata(
      track,
      () => seq === mediaSessionMetadataScheduleSeq && isCurrent(),
    );
  }, delayMs);
}

function revokeMediaSessionArtworkObjectUrl(): void {
  if (!mediaSessionArtworkObjectUrl) return;
  URL.revokeObjectURL(mediaSessionArtworkObjectUrl);
  mediaSessionArtworkObjectUrl = null;
}

function observePlaybackListen(state: PlayerState, positionSec: number, durationSec: number): void {
  const track = state.queue[state.currentIndex];
  if (!track) return;
  const flushed = playbackListenTracker.update({
    trackId: track.id,
    positionSec,
    durationSec: durationSec || track.durationSec,
    now: Date.now(),
    context: {
      source: track.remoteMediaUrl ? "shared-drive" : "local",
      setId: state.activeSessionId ?? undefined,
    },
  });
  if (flushed) persistPlaybackListen(flushed);
}

function flushPlaybackListen(now: number): void {
  const flushed = playbackListenTracker.flush(now);
  if (!flushed) return;
  // Per-switch stats visibility: shows whether the OUTGOING track logged any
  // listen seconds (so whether a play is counted + a stats DB write queued). The
  // write itself is async/off the switch frame — rapid skips log ~0s and never
  // touch the DB, which this confirms in a captured trace (user Q2).
  playbackLog.debug("listen.flush", {
    category: "media",
    phase: "state",
    trackId: flushed.trackId,
    listenedSec: Math.round(flushed.listenedSec * 100) / 100,
    durationSec: flushed.durationSec,
    counts: flushed.listenedSec > 0,
  });
  persistPlaybackListen(flushed);
}

function persistPlaybackListen(flush: PlaybackListenFlush): void {
  if (flush.listenedSec <= 0) return;
  void getOrCreateLocalDevice()
    .then((device) =>
      recordPlaybackListen({
        devicePublicId: device.publicId,
        trackId: flush.trackId,
        durationSec: flush.durationSec,
        listenedSec: flush.listenedSec,
        startedAt: flush.startedAt,
        endedAt: flush.endedAt,
        context: flush.context,
      }),
    )
    .catch((error: unknown) => log.warn("player", "failed to record playback stats", error));
}

type PlaybackPresenceEvent = "trackStarted" | "trackChanged" | "paused" | "resumed" | "stopped";

function publishPlaybackPresence(event: PlaybackPresenceEvent, state: PlayerState): void {
  void getPresenceCoordinator()
    .then((coordinator) => {
      if (!coordinator) return;
      const snapshot = playerPresenceSnapshot(state);
      switch (event) {
        case "trackStarted":
          return coordinator.trackStarted(snapshot);
        case "trackChanged":
          return coordinator.trackChanged(snapshot);
        case "paused":
          return coordinator.paused({ positionSec: snapshot.positionSec });
        case "resumed":
          return coordinator.resumed({ positionSec: snapshot.positionSec });
        case "stopped":
          return coordinator.stopped({ positionSec: snapshot.positionSec });
      }
    })
    .catch((error: unknown) => log.warn("player", "failed to publish presence", error));
}

function playerPresenceSnapshot(state: PlayerState) {
  const track = state.queue[state.currentIndex];
  return {
    trackId: track?.id,
    setId: state.activeSessionId ?? undefined,
    positionSec: state.positionSec,
  };
}

async function getPresenceCoordinator(): Promise<R2PresenceCoordinator | null> {
  const settings = await getSettings();
  if (!settings.presenceEnabled) return null;

  const drives = await listCloudDrives();
  const drive = drives.find(
    (candidate) =>
      canWritePresenceToDrive(settings, candidate) &&
      Boolean(settings.r2CredentialsByDriveId?.[candidate.id]),
  );
  if (!drive) return null;

  const device = await getOrCreateLocalDevice();
  const key = `${drive.id}:${device.publicId}:${device.name}`;
  if (presenceCoordinator && presenceCoordinatorKey === key) return presenceCoordinator;

  presenceCoordinatorKey = key;
  presenceCoordinator = createR2PresenceCoordinator({
    devicePublicId: device.publicId,
    deviceName: device.name,
    writePresence: async (presence) => {
      await writeR2Presence({ settings, drive, presence });
    },
  });
  return presenceCoordinator;
}

async function afterQueueUpdate(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  if (wantPlay && currentIndex >= 0 && currentIndex < queue.length) {
    const track = queue[currentIndex];
    if (track.status === "ready" && loadedTrackId !== track.id) {
      await ensureLoadedAndPlay(set, get);
    }
  }
  void pump(set, get);
}

/** Generate audio for pending tracks, one at a time. */
async function pump(set: (p: Partial<PlayerState>) => void, get: () => PlayerState): Promise<void> {
  if (pumping || !djEngine) return;
  const { activeSessionId } = get();
  if (!activeSessionId) return;
  pumping = true;
  set({ isGenerating: true });
  try {
    while (true) {
      const produced = await djEngine.materializeNext(activeSessionId);
      if (!produced) break;
    }
  } catch (err) {
    log.error("player", "pump error", err);
  } finally {
    pumping = false;
    set({ isGenerating: false });
  }
}

/** Ask the DJ to extend the set when it has run low (续上歌单) — DJ sets only. */
async function maybeRefill(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { activeSessionId, currentIndex, isDrafting, djEnabled, queue } = get();
  if (!activeSessionId || !djEngine || isDrafting || !djEnabled) return;
  // Don't append/mutate the queue while a cover-pager drag window is open — index
  // shifts would desync the open window. The settle commit (a normal playIndex once
  // the gesture ends, with the flag cleared) runs the deferred refill.
  if (coverGestureActive) return;
  set({ isDrafting: true });
  try {
    // Refill is measured on the play queue (what's left to play), not set count.
    const refilled = await djEngine.refillIfNeeded(activeSessionId, queue.length, currentIndex);
    if (refilled && refilled.length > 0)
      log.info("player", `DJ extended the set by ${refilled.length}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    set({ djError: msg });
  } finally {
    set({ isDrafting: false });
    void pump(set, get);
  }
}

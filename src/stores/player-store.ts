import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";
import { db } from "@/db/muzero-db";
import {
  createSession,
  createUploadedTrack,
  deleteSession as deleteSessionRepo,
  getPlayQueue,
  getSession,
  getSettings,
  getTrackBlob,
  getTrackCover,
  getTracksByIds,
  knownSourcePaths,
  playQueueAppend,
  playQueuePlayNext,
  playQueueSet,
  playQueueSetContext,
  playQueueSetIndex,
  prependTrackIds,
  saveSettings,
  setSessionDisplayMode,
  setTrackCover,
  upsertImportFolder,
} from "@/db/repositories";
import type { ImportFolder, SetDisplayMode, Track } from "@/db/types";
import { createAiDjBrain } from "@/dj/dj-brain-ai";
import { createDjEngine, type DjEngine } from "@/dj/dj-engine";
import i18n from "@/i18n/i18n";
import { hasFolderAccess } from "@/lib/desktop/bridge";
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
import { log } from "@/lib/logger";
import { fallbackUploadMediaMetadata, parseUploadedMediaMetadata } from "@/lib/media-metadata";
import { isUnsupportedMediaError, probeMediaFile } from "@/lib/media-probe";
import {
  canSetPlatformMediaSessionMetadata,
  setPlatformMediaSessionMetadata,
} from "@/lib/media-session";
import { isNcmFile } from "@/lib/ncm-decode";
import { getAppFetch } from "@/lib/platform";
import { runAutoFetchLyrics } from "@/lyrics/auto-fetch";
import { resolveLyricsProvider } from "@/lyrics/registry";
import { resolveMusicGenProvider } from "@/musicgen/registry";
import { MediaEngine } from "@/player/media-engine";
import { reconcileCurrentIndex, unconsumedTrackIds } from "@/player/play-queue";
import {
  buildShuffleOrder,
  clampIndex,
  manualNextIndex,
  prevIndex,
  type RepeatMode,
  shuffleManualNext,
  shufflePrev,
} from "@/player/queue";
import {
  beginFolderImport,
  endFolderImport,
  setFolderImportProgress,
} from "@/stores/folder-import-store";
import { notify } from "@/stores/notification-store";
import { createStreamSource } from "@/streamsrc/registry";
import { resolveStreamedTrackMedia } from "@/streamsrc/resolve-playback";
import { isStreamedTrack } from "@/streamsrc/source-detect";
import { createStreamHttp } from "@/streamsrc/stream-http";
import { listCloudDrives } from "@/sync/cloud-drive-repo";
import { getOrCreateLocalDevice } from "@/sync/device-repo";
import {
  createPlaybackListenTracker,
  type PlaybackListenFlush,
} from "@/sync/playback-listen-session";
import { recordPlaybackListen } from "@/sync/playback-stats";
import { canWritePresenceToDrive } from "@/sync/r2-presence";
import {
  createR2PresenceCoordinator,
  type R2PresenceCoordinator,
} from "@/sync/r2-presence-coordinator";
import { writeR2Presence } from "@/sync/r2-presence-sync";
import { ingestViaWorker } from "@/workers/heavy-client";

interface PlayerState {
  activeSessionId: string | null;
  /** Reactive snapshot of the active set's tracks, in queue order. */
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  wantPlay: boolean;
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
  djError: string | null;

  init: () => void;
  setActiveSession: (sessionId: string) => Promise<void>;
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
  next: () => Promise<void>;
  /** Previous track without the transport-button "restart current after 3s" rule. */
  skipPrev: () => Promise<void>;
  prev: () => Promise<void>;
  /** Read the track that a manual next/previous action would move to. */
  peekTrack: (direction: "next" | "prev") => Track | undefined;
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
let lyricsAbort: AbortController | null = null;
let playbackSettingsLoaded = false;
// The active shuffled play order (queue indices). Non-reactive: next/prev read it,
// setShuffle rebuilds it, and it self-heals when stale vs the queue length.
let shuffleOrder: number[] = [];
const playbackListenTracker = createPlaybackListenTracker();
let presenceCoordinator: R2PresenceCoordinator | null = null;
let presenceCoordinatorKey = "";
// Signature of the last `queue` we published, so a playQueue-row write that
// doesn't change the rendered list (e.g. a future currentIndex / repeat persist)
// doesn't churn the `queue` array and re-render every list consumer.
let lastQueueSig = "";

/** Cheap signature of what the queue list renders (ids + generation status +
 * cover identity). `coverBlobId`/`coverCrop` are included so a cover edit on the
 * current track republishes `queue` and the now-playing stage reacts live —
 * without them, a cover-only change keeps the same sig and gets swallowed. */
function queueSig(tracks: Track[]): string {
  return tracks
    .map((t) => {
      const c = t.coverCrop;
      const crop = c ? `${c.x},${c.y},${c.width},${c.height}` : "";
      return `${t.id}:${t.status}:${t.blobId ?? ""}:${t.remoteMediaUrl ?? ""}:${t.coverBlobId ?? ""}:${t.remoteCoverUrl ?? ""}:${crop}`;
    })
    .join("|");
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  activeSessionId: null,
  queue: [],
  currentIndex: -1,
  isPlaying: false,
  wantPlay: false,
  positionSec: 0,
  durationSec: 0,
  volume: 0.9,
  repeat: "off",
  shuffle: false,
  displayMode: "video",
  djEnabled: true,
  isDrafting: false,
  isGenerating: false,
  isUploading: false,
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
        set({ positionSec, durationSec });
        observePlaybackListen(get(), positionSec, durationSec);
      },
      onPlayStateChange: (isPlaying) => {
        if (!isPlaying) flushPlaybackListen(Date.now());
        set({ isPlaying });
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
    void hydratePlaybackSettings(set, get).catch((err: unknown) =>
      log.warn("player", "failed to hydrate playback settings", err),
    );
    void get()
      .rebuildEngine()
      .catch((err: unknown) => log.warn("player", "failed to build DJ engine", err));

    // The player consumes the persistent 播放列表 (Play Queue), not a 歌单 directly.
    // This single subscription keeps `queue` in sync as the queue is loaded /
    // extended / edited.
    liveQuery(async () => {
      const pq = await getPlayQueue();
      const queue = await getTracksByIds(pq.entries.map((e) => e.trackId));
      const session = pq.contextSetId ? await getSession(pq.contextSetId) : undefined;
      return { pq, queue, session };
    }).subscribe({
      next: ({ pq, queue, session }) => {
        const contextSetId = pq.contextSetId ?? null;
        watchSetForAppend(
          contextSetId,
          pq.entries.map((e) => e.trackId),
        );

        const sig = queueSig(queue);
        const listChanged = sig !== lastQueueSig;
        lastQueueSig = sig;
        const persistedIndex = clampIndex(queue.length, pq.currentIndex);
        // Pin the cursor to the PLAYING track by id only when the queue list
        // itself changed. Pure currentIndex writes (same list) should follow the
        // persisted queue cursor so refresh/other writers restore the right song.
        const currentIndex = listChanged
          ? reconcileCurrentIndex(
              queue.map((tr) => tr.id),
              loadedTrackId,
              persistedIndex,
            )
          : persistedIndex;
        const state = get();
        const patch: Partial<PlayerState> = {
          activeSessionId: contextSetId,
          currentIndex,
          displayMode: session?.displayMode ?? state.displayMode,
          djEnabled: session?.config.autoExtend ?? false,
        };
        if (listChanged) patch.queue = queue;
        const changed =
          listChanged ||
          state.activeSessionId !== patch.activeSessionId ||
          state.currentIndex !== patch.currentIndex ||
          state.displayMode !== patch.displayMode ||
          state.djEnabled !== patch.djEnabled;
        if (!changed) return;
        set(patch);
        void afterQueueUpdate(set, get);
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

    // Load this 歌单 into the 播放列表 (replace) and mark how many of its tracks the
    // queue has consumed (high-water). Also seed `queue` synchronously so callers
    // that read it right after (e.g. playTrack) don't race the liveQuery.
    await playQueueSet(trackIds, { contextSetId: sessionId, currentIndex: -1 });
    consumedTrackIds = new Set(trackIds);
    const initialQueue = await getTracksByIds(trackIds);
    lastQueueSig = queueSig(initialQueue); // keep the guard in sync with the optimistic seed
    set({
      activeSessionId: sessionId,
      queue: initialQueue,
      currentIndex: -1,
      wantPlay: false,
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
    mediaEngine?.pause();
    void publishPlaybackPresence("paused", get());
  },

  togglePlay() {
    if (get().isPlaying) get().pause();
    else void get().play();
  },

  async playIndex(index) {
    const { queue } = get();
    const clamped = clampIndex(queue.length, index);
    log.debug("player", "playIndex", {
      requestedIndex: index,
      clamped,
      queueLength: queue.length,
      trackId: clamped >= 0 ? queue[clamped]?.id : null,
    });
    set({ currentIndex: clamped, wantPlay: true });
    persistQueueIndex(clamped);
    await ensureLoadedAndPlay(set, get);
    void maybeRefill(set, get);
  },

  async cueIndex(index) {
    const { queue } = get();
    const clamped = clampIndex(queue.length, index);
    // wantPlay:false makes ensureLoadedAndPlay load + show the track but skip
    // play() — so a fresh launch never fires a gesture-blocked play() / spins up
    // the AudioContext before the user has interacted.
    set({ currentIndex: clamped, wantPlay: false });
    persistQueueIndex(clamped);
    await ensureLoadedAndPlay(set, get);
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

  seek(sec) {
    mediaEngine?.seek(sec);
    set({ positionSec: sec });
  },

  setVolume(v) {
    mediaEngine?.setVolume(v);
    set({ volume: v });
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
    set({ isUploading: true });
    try {
      const ids: string[] = [];
      const unsupported: string[] = [];
      for (const file of list) {
        const r = await ingestMediaFile(setId, file);
        if (r.trackId) ids.push(r.trackId);
        else if (r.unsupportedName) unsupported.push(r.unsupportedName);
      }
      // Newest on top (prepend) — the first added track becomes the set's cover.
      if (ids.length > 0) await prependTrackIds(setId, ids);
      if (unsupported.length > 0) {
        notify.warning(i18n.t("drop.skipped", { count: unsupported.length }), {
          detail: `${unsupported.join(", ")} — ${i18n.t("nowPlaying.videoUnsupported")}`,
        });
      }
      log.info("player", `uploaded ${ids.length} file(s) to ${setId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ djError: msg });
      log.error("player", "upload failed", msg);
    } finally {
      set({ isUploading: false });
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
      set({ activeSessionId: null, djEnabled: false });
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
): Promise<IngestResult> {
  // `.ncm` can't be probed/played encrypted — decrypt in the worker, then pull
  // its cover from the carried CDN URL if no image was embedded.
  if (isNcmFile(file.name)) return ingestNcmFile(setId, file, sourcePath);

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

  const track = await createUploadedTrack({
    sessionId: setId,
    title: parsed.title ?? probed.title,
    kind: probed.kind,
    blob: file,
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
): Promise<IngestResult> {
  const bytes = await file.arrayBuffer();
  const res = await ingestViaWorker({
    setId,
    name: file.name,
    kind: "audio",
    mime: "",
    sourcePath,
    bytes,
    decode: "ncm",
  }).catch((err: unknown) => {
    log.warn("player", "ncm decode failed", { name: file.name, err: String(err) });
    return null;
  });
  if (!res) return { unsupportedName: file.name };
  if (!res.hasCover && res.albumPicUrl) {
    void fetchAndStoreRemoteCover(res.trackId, res.albumPicUrl);
  }
  return { trackId: res.trackId };
}

/**
 * Download a track's remote cover (the `albumPic` URL an `.ncm` carries) and store
 * it as the cover blob. Best-effort + non-blocking: the track is already playable,
 * so a failed/offline fetch just leaves it cover-less; never throws to the caller.
 * Routed through `getAppFetch()` so it bypasses CORS on the desktop shells.
 */
async function fetchAndStoreRemoteCover(trackId: string, url: string): Promise<void> {
  try {
    const appFetch = await getAppFetch();
    const resp = await appFetch(url);
    if (!resp.ok) return;
    const blob = await resp.blob();
    if (blob.size === 0) return;
    const mime =
      resp.headers.get("content-type")?.split(";")[0]?.trim() || blob.type || "image/jpeg";
    if (!mime.startsWith("image/")) return;
    await setTrackCover({ trackId, blob, mime });
  } catch (err) {
    log.warn("player", "failed to fetch remote cover", { trackId, err: String(err) });
  }
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

      const scan = await scanFolderForMedia(folder.path, fs).catch((err: unknown) => {
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
    setFolderImportProgress({ phase: "importing", done, total, imported, encrypted, decodeFailed });
    for (const plan of plans) {
      const ids: string[] = [];
      for (const file of plan.fresh) {
        if (signal.aborted) break;
        try {
          // Read on the main thread (async IPC/plugin — off the CPU), then hand the
          // bytes to the worker for the heavy parse/decrypt + DB write (no UI jank).
          const bytes = await fs.readFile(file.path);
          const res = await ingestViaWorker({
            setId: plan.setId,
            name: file.name,
            kind: file.kind,
            mime: file.decode === "ncm" ? "" : mimeFromExtension(file.name, file.kind),
            sourcePath: file.path,
            bytes: bytes.buffer as ArrayBuffer,
            decode: file.decode,
          });
          ids.push(res.trackId);
          imported += 1;
          // No embedded image but a carried cover URL (`.ncm`, or a plaintext mp3
          // with a NetEase "163 key" comment) → pull + store it.
          if (!res.hasCover && res.albumPicUrl) {
            void fetchAndStoreRemoteCover(res.trackId, res.albumPicUrl);
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
      if (ids.length > 0) await prependTrackIds(plan.setId, ids);
      await upsertImportFolder({
        ...plan.folder,
        setId: plan.setId,
        lastScanAt: Date.now(),
        lastImportedCount: ids.length,
      });
      if (signal.aborted) break;
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

function persistQueueIndex(index: number): void {
  void playQueueSetIndex(index).catch((err: unknown) =>
    log.warn("player", "failed to persist queue index", err),
  );
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
  const repeat = settings.playerRepeatMode ?? "off";
  const shuffle = settings.playerShuffle ?? false;
  set({ repeat, shuffle });
  shuffleOrder = shuffle ? buildShuffleOrder(get().queue.length, get().currentIndex) : [];
}

/**
 * Fire-and-forget LRCLIB auto-fetch for the now-current track. Module scope (not
 * store state) so per-frame playback never re-renders on it (rule 6). Aborts any
 * in-flight fetch when the track changes; generated tracks use brief.lyrics and
 * skip the network. All eligibility checks live in runAutoFetchLyrics.
 */
function triggerLyricsAutoFetch(track: Track): void {
  lyricsAbort?.abort();
  if (track.origin === "generated") return;
  const controller = new AbortController();
  lyricsAbort = controller;
  void (async () => {
    try {
      const settings = await getSettings();
      await runAutoFetchLyrics({
        track,
        settings,
        provider: resolveLyricsProvider(settings),
        signal: controller.signal,
      });
    } catch (err) {
      log.warn("lyrics", "auto-fetch trigger failed", err);
    }
  })();
}

async function ensureLoadedAndPlay(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  log.debug("player", "ensureLoadedAndPlay", { currentIndex, queueLength: queue.length, wantPlay });
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  const track = queue[currentIndex];
  if (!mediaEngine) return;
  const hasPlayableMedia = !!track.blobId || !!track.remoteMediaUrl || isStreamedTrack(track);
  if (track.status !== "ready" || !hasPlayableMedia) {
    log.debug("player", "track is not playable yet", {
      trackId: track.id,
      status: track.status,
      hasBlob: !!track.blobId,
      hasRemoteMedia: !!track.remoteMediaUrl,
    });
    void pump(set, get);
    return;
  }
  const previousLoadedTrackId = loadedTrackId;
  if (loadedTrackId !== track.id) {
    flushPlaybackListen(Date.now());
    if (track.blobId) {
      const media = await getTrackBlob(track);
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
      await mediaEngine.loadBlob(media.blob, track.kind);
    } else if (track.remoteMediaUrl) {
      log.debug("player", "loading remote media url", {
        trackId: track.id,
        kind: track.kind,
      });
      await mediaEngine.loadUrl(track.remoteMediaUrl, track.kind);
    } else if (isStreamedTrack(track)) {
      // External streaming source: resolve a short-lived URL right before play.
      // NetEase plays directly; Bilibili's URL needs the media proxy to inject a
      // Referer (returned in `headers`, wired once the proxy lands) — until then a
      // bili stream loads but the CDN GET 403s.
      const settings = await getSettings();
      const http = createStreamHttp();
      const resolved = await resolveStreamedTrackMedia(track, {
        resolveSource: (id) =>
          createStreamSource(id, {
            http,
            now: () => Date.now(),
            getCookie: (sid) => settings.streamSources?.[sid]?.cookie,
          }),
        getQuality: (id) => settings.streamSources?.[id]?.quality,
      });
      if (resolved.kind !== "ok") {
        log.warn("player", "streamed resolve failed", { trackId: track.id, result: resolved });
        notify.error(i18n.t("player.playbackError"));
        return;
      }
      log.debug("player", "loading streamed media url", {
        trackId: track.id,
        source: track.streamSourceId,
      });
      await mediaEngine.loadUrl(resolved.url, track.kind);
    }
    loadedTrackId = track.id;
    triggerLyricsAutoFetch(track);
    await updateMediaSessionMetadata(track);
  }
  if (wantPlay) {
    log.debug("player", "playing media", { trackId: track.id });
    await mediaEngine.play();
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

async function updateMediaSessionMetadata(track: Track): Promise<void> {
  if (!canSetPlatformMediaSessionMetadata()) {
    revokeMediaSessionArtworkObjectUrl();
    return;
  }

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
    const cover = await getTrackCover(track);
    if (cover?.blob) {
      nextArtworkObjectUrl = URL.createObjectURL(cover.blob);
      artwork = { src: nextArtworkObjectUrl, mime: cover.mime };
    }
  }

  if (loadedTrackId !== track.id) {
    if (nextArtworkObjectUrl) URL.revokeObjectURL(nextArtworkObjectUrl);
    return;
  }

  setPlatformMediaSessionMetadata(track, artwork);
  if (mediaSessionArtworkObjectUrl && mediaSessionArtworkObjectUrl !== nextArtworkObjectUrl) {
    URL.revokeObjectURL(mediaSessionArtworkObjectUrl);
  }
  mediaSessionArtworkObjectUrl = nextArtworkObjectUrl;
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
  if (flushed) persistPlaybackListen(flushed);
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

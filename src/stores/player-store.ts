import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";
import { db } from "@/db/muzero-db";
import {
  createSession,
  createUploadedTrack,
  getPlayQueue,
  getSession,
  getSettings,
  getTrackBlob,
  getTracksByIds,
  incrementPlayCount,
  playQueueAppend,
  playQueuePlayNext,
  playQueueSet,
  playQueueSetIndex,
  prependTrackIds,
  saveSettings,
  setSessionDisplayMode,
} from "@/db/repositories";
import type { SetDisplayMode, Track } from "@/db/types";
import { createAiDjBrain } from "@/dj/dj-brain-ai";
import { createDjEngine, type DjEngine } from "@/dj/dj-engine";
import i18n from "@/i18n/i18n";
import { log } from "@/lib/logger";
import { isUnsupportedMediaError, probeMediaFile } from "@/lib/media-probe";
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
import { notify } from "@/stores/notification-store";

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
  /** Manually ask the DJ to draft more now. */
  draftNow: () => Promise<void>;
}

// Non-reactive singletons (never selected by components → no rerenders).
let mediaEngine: MediaEngine | null = null;

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
let playbackSettingsLoaded = false;
// The active shuffled play order (queue indices). Non-reactive: next/prev read it,
// setShuffle rebuilds it, and it self-heals when stale vs the queue length.
let shuffleOrder: number[] = [];
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
        const state = get();
        if (state.repeat === "one" && state.currentIndex >= 0) {
          state.seek(0);
          void state.playIndex(state.currentIndex);
          return;
        }
        void state.next();
      },
      onTimeUpdate: (positionSec, durationSec) => set({ positionSec, durationSec }),
      onPlayStateChange: (isPlaying) => set({ isPlaying }),
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
        const probed = await probeMediaFile(file).catch((err: unknown) => {
          if (!isUnsupportedMediaError(err)) throw err;
          unsupported.push(err.fileName);
          log.warn("player", "skipped unsupported upload", {
            fileName: err.fileName,
            mime: err.mime,
            kind: err.kind,
            mediaErrorCode: err.mediaErrorCode,
          });
          return null;
        });
        if (!probed) continue;
        const track = await createUploadedTrack({
          sessionId: setId,
          title: probed.title,
          kind: probed.kind,
          blob: file,
          mime: probed.mime,
          durationSec: probed.durationSec,
        });
        ids.push(track.id);
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

async function ensureLoadedAndPlay(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  log.debug("player", "ensureLoadedAndPlay", { currentIndex, queueLength: queue.length, wantPlay });
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  const track = queue[currentIndex];
  if (!mediaEngine) return;
  const hasPlayableMedia = !!track.blobId || !!track.remoteMediaUrl;
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
  if (loadedTrackId !== track.id) {
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
    }
    loadedTrackId = track.id;
    void incrementPlayCount(track.id);
  }
  if (wantPlay) {
    log.debug("player", "playing media", { trackId: track.id });
    await mediaEngine.play();
  }
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

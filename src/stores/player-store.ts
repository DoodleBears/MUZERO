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
  playQueueSet,
  prependTrackIds,
  saveSettings,
  setSessionDisplayMode,
} from "@/db/repositories";
import type { SetDisplayMode, Track } from "@/db/types";
import { createAiDjBrain } from "@/dj/dj-brain-ai";
import { createDjEngine, type DjEngine } from "@/dj/dj-engine";
import { log } from "@/lib/logger";
import { probeMediaFile } from "@/lib/media-probe";
import { resolveMusicGenProvider } from "@/musicgen/registry";
import { MediaEngine } from "@/player/media-engine";
import { unconsumedTrackIds } from "@/player/play-queue";
import {
  buildShuffleOrder,
  clampIndex,
  nextIndex,
  prevIndex,
  type RepeatMode,
  shuffleNext,
  shufflePrev,
} from "@/player/queue";

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
  /** Auto-advance to the next track when one ends (manual next/prev always work). */
  autoplay: boolean;
  /** Stage rendering for the active set (video-first → cover → title). */
  displayMode: SetDisplayMode;
  /** Force audio-only: play a video's audio without showing the video. */
  audioOnly: boolean;
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
  /** Play a specific track, switching sets if needed (search/library result). */
  playTrack: (track: Track) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setRepeat: (mode: RepeatMode) => void;
  setShuffle: (on: boolean) => void;
  setAutoplay: (on: boolean) => void;
  setDisplayMode: (mode: SetDisplayMode) => Promise<void>;
  setAudioOnly: (audioOnly: boolean) => void;
  /** Import uploaded audio/video files into the active set. */
  addUploads: (files: FileList | File[]) => Promise<void>;
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
let consumedTrackIds = new Set<string>();
let djEngine: DjEngine | null = null;
let pumping = false;
let loadedTrackId: string | null = null;
// The active shuffled play order (queue indices). Non-reactive: next/prev read it,
// setShuffle rebuilds it, and it self-heals when stale vs the queue length.
let shuffleOrder: number[] = [];
// Signature of the last `queue` we published, so a playQueue-row write that
// doesn't change the rendered list (e.g. a future currentIndex / repeat persist)
// doesn't churn the `queue` array and re-render every list consumer.
let lastQueueSig = "";

/** Cheap signature of what the queue list renders (ids + generation status). */
function queueSig(tracks: Track[]): string {
  return tracks.map((t) => `${t.id}:${t.status}:${t.blobId ?? ""}`).join("|");
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
  autoplay: true,
  displayMode: "video",
  audioOnly: false,
  djEnabled: true,
  isDrafting: false,
  isGenerating: false,
  isUploading: false,
  djError: null,

  init() {
    if (mediaEngine) return;
    mediaEngine = new MediaEngine({
      // Auto-advance only when autoplay is on; "repeat one" always re-loops.
      onEnded: () => {
        if (get().autoplay || get().repeat === "one") void get().next();
      },
      onTimeUpdate: (positionSec, durationSec) => set({ positionSec, durationSec }),
      onPlayStateChange: (isPlaying) => set({ isPlaying }),
      onError: (msg) => set({ djError: msg }),
    });
    mediaEngine.setVolume(get().volume);

    // The player consumes the persistent 播放列表 (Play Queue), not a 歌单 directly.
    // This single subscription keeps `queue` in sync as the queue is loaded /
    // extended / edited.
    liveQuery(async () => {
      const pq = await getPlayQueue();
      return getTracksByIds(pq.entries.map((e) => e.trackId));
    }).subscribe({
      next: (queue) => {
        const sig = queueSig(queue);
        if (sig === lastQueueSig) return; // list unchanged → don't churn subscribers
        lastQueueSig = sig;
        set({ queue });
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
    get().init();
    await get().rebuildEngine();
    setSub?.unsubscribe();

    const session = await getSession(sessionId);
    const trackIds = session?.trackIds ?? [];
    loadedTrackId = null;

    // Load this 歌单 into the 播放列表 (replace) and mark how many of its tracks the
    // queue has consumed (high-water). Also seed `queue` synchronously so callers
    // that read it right after (e.g. playTrack) don't race the liveQuery.
    await playQueueSet(trackIds, { contextSetId: sessionId });
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
    await saveSettings({ lastSessionId: sessionId });

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
    set({ currentIndex: clamped, wantPlay: true });
    await ensureLoadedAndPlay(set, get);
    void maybeRefill(set, get);
  },

  async playTrack(track) {
    if (get().activeSessionId !== track.sessionId) {
      await get().setActiveSession(track.sessionId);
    }
    const idx = get().queue.findIndex((t) => t.id === track.id);
    if (idx >= 0) await get().playIndex(idx);
  },

  async next() {
    const { queue, currentIndex, repeat, shuffle } = get();
    let ni: number | null;
    if (shuffle) {
      const r = shuffleNext(shuffleOrder, queue.length, currentIndex, repeat);
      shuffleOrder = r.order;
      ni = r.index;
    } else {
      ni = nextIndex(queue.length, currentIndex, repeat);
    }
    if (ni === null) {
      get().pause();
      set({ isPlaying: false });
      void maybeRefill(set, get);
      return;
    }
    await get().playIndex(ni);
  },

  async prev() {
    const { queue, currentIndex, repeat, positionSec, shuffle } = get();
    if (positionSec > 3) {
      get().seek(0);
      return;
    }
    let pi: number | null;
    if (shuffle) {
      const r = shufflePrev(shuffleOrder, queue.length, currentIndex, repeat);
      shuffleOrder = r.order;
      pi = r.index;
    } else {
      pi = prevIndex(queue.length, currentIndex, repeat);
    }
    if (pi === null) return;
    await get().playIndex(pi);
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
  },

  setShuffle(on) {
    set({ shuffle: on });
    shuffleOrder = on ? buildShuffleOrder(get().queue.length, get().currentIndex) : [];
  },

  setAutoplay(on) {
    set({ autoplay: on });
  },

  async setDisplayMode(mode) {
    const { activeSessionId } = get();
    set({ displayMode: mode });
    if (activeSessionId) await setSessionDisplayMode(activeSessionId, mode);
  },

  setAudioOnly(audioOnly) {
    set({ audioOnly });
  },

  async addUploads(files) {
    const { activeSessionId } = get();
    if (!activeSessionId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    set({ isUploading: true });
    try {
      const ids: string[] = [];
      for (const file of list) {
        const probed = await probeMediaFile(file);
        const track = await createUploadedTrack({
          sessionId: activeSessionId,
          title: probed.title,
          kind: probed.kind,
          blob: file,
          mime: probed.mime,
          durationSec: probed.durationSec,
        });
        ids.push(track.id);
      }
      await prependTrackIds(activeSessionId, ids);
      log.info("player", `uploaded ${ids.length} file(s)`);
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

async function ensureLoadedAndPlay(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  const track = queue[currentIndex];
  if (!mediaEngine) return;
  if (track.status !== "ready" || !track.blobId) {
    void pump(set, get);
    return;
  }
  if (loadedTrackId !== track.id) {
    const media = await getTrackBlob(track);
    if (!media) return;
    await mediaEngine.loadBlob(media.blob);
    loadedTrackId = track.id;
    void incrementPlayCount(track.id);
  }
  if (wantPlay) await mediaEngine.play();
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

import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";
import { db } from "@/db/muzero-db";
import {
  getSession,
  getSettings,
  getTrackBlob,
  getTracksByIds,
  incrementPlayCount,
  saveSettings,
} from "@/db/repositories";
import type { Track } from "@/db/types";
import { createAiDjBrain } from "@/dj/dj-brain-ai";
import { createDjEngine, type DjEngine } from "@/dj/dj-engine";
import { log } from "@/lib/logger";
import { resolveMusicGenProvider } from "@/musicgen/registry";
import { AudioEngine } from "@/player/audio-engine";
import { clampIndex, nextIndex, prevIndex, type RepeatMode } from "@/player/queue";

interface PlayerState {
  activeSessionId: string | null;
  /** Reactive snapshot of the active session's tracks, in queue order. */
  queue: Track[];
  currentIndex: number;
  isPlaying: boolean;
  /** Whether the user intends playback (so we autoplay once the track is ready). */
  wantPlay: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  repeat: RepeatMode;
  /** DJ status flags for the console UI. */
  isDrafting: boolean;
  isGenerating: boolean;
  djError: string | null;

  init: () => void;
  setActiveSession: (sessionId: string) => Promise<void>;
  rebuildEngine: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => void;
  playIndex: (index: number) => Promise<void>;
  next: () => Promise<void>;
  prev: () => Promise<void>;
  seek: (sec: number) => void;
  setVolume: (v: number) => void;
  setRepeat: (mode: RepeatMode) => void;
  /** Manually ask the DJ to draft more now. */
  draftNow: () => Promise<void>;
}

// Non-reactive singletons (never selected by components → no rerenders).
let audioEngine: AudioEngine | null = null;

/** Access the shared audio engine (e.g. for the visualizer's analyser node). */
export function getAudioEngine(): AudioEngine | null {
  return audioEngine;
}

let queueSub: Subscription | null = null;
let djEngine: DjEngine | null = null;
let pumping = false;
let loadedTrackId: string | null = null;

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
  isDrafting: false,
  isGenerating: false,
  djError: null,

  init() {
    if (audioEngine) return;
    audioEngine = new AudioEngine({
      onEnded: () => void get().next(),
      onTimeUpdate: (positionSec, durationSec) => set({ positionSec, durationSec }),
      onPlayStateChange: (isPlaying) => set({ isPlaying }),
      onError: (msg) => set({ djError: msg }),
    });
    audioEngine.setVolume(get().volume);
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
    queueSub?.unsubscribe();
    set({ activeSessionId: sessionId, currentIndex: -1, wantPlay: false });
    await saveSettings({ lastSessionId: sessionId });

    // Subscribe to the session's queue so generation progress streams into state.
    queueSub = liveQuery(async () => {
      const session = await getSession(sessionId);
      if (!session) return [] as Track[];
      return getTracksByIds(session.trackIds);
    }).subscribe({
      next: (queue) => {
        set({ queue });
        void afterQueueUpdate(set, get);
      },
      error: (err) => log.error("player", "queue subscription error", err),
    });

    // Seed an empty session with a first batch.
    const session = await getSession(sessionId);
    if (session && session.trackIds.length === 0) void get().draftNow();
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
    audioEngine?.pause();
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
    // Advancing may have drained the queue — let the DJ keep it going.
    void maybeRefill(set, get);
  },

  async next() {
    const { queue, currentIndex, repeat } = get();
    const ni = nextIndex(queue.length, currentIndex, repeat);
    if (ni === null) {
      get().pause();
      set({ isPlaying: false });
      void maybeRefill(set, get);
      return;
    }
    await get().playIndex(ni);
  },

  async prev() {
    const { queue, currentIndex, repeat, positionSec } = get();
    // Restart the current track if we're more than 3s in (familiar UX).
    if (positionSec > 3) {
      get().seek(0);
      return;
    }
    const pi = prevIndex(queue.length, currentIndex, repeat);
    if (pi === null) return;
    await get().playIndex(pi);
  },

  seek(sec) {
    audioEngine?.seek(sec);
    set({ positionSec: sec });
  },

  setVolume(v) {
    audioEngine?.setVolume(v);
    set({ volume: v });
  },

  setRepeat(mode) {
    set({ repeat: mode });
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

/** Load the current track's blob (if ready) and play if the user wants playback. */
async function ensureLoadedAndPlay(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { queue, currentIndex, wantPlay } = get();
  if (currentIndex < 0 || currentIndex >= queue.length) return;
  const track = queue[currentIndex];
  if (!audioEngine) return;
  if (track.status !== "ready" || !track.blobId) {
    // Not generated yet — kick the pump; afterQueueUpdate will autoplay later.
    void pump(set, get);
    return;
  }
  if (loadedTrackId !== track.id) {
    const media = await getTrackBlob(track);
    if (!media) return;
    await audioEngine.loadBlob(media.blob);
    loadedTrackId = track.id;
    void incrementPlayCount(track.id);
  }
  if (wantPlay) await audioEngine.play();
}

/** React to queue changes: autoplay a freshly-ready current track, keep pumping. */
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

/** Generate audio for pending tracks, one at a time (local models are single-batch). */
async function pump(set: (p: Partial<PlayerState>) => void, get: () => PlayerState): Promise<void> {
  if (pumping || !djEngine) return;
  const { activeSessionId } = get();
  if (!activeSessionId) return;
  pumping = true;
  set({ isGenerating: true });
  try {
    // Materialize until nothing is pending. liveQuery updates `queue` between iters.
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

/** Ask the DJ to extend the queue when it has run low (续上歌单). */
async function maybeRefill(
  set: (p: Partial<PlayerState>) => void,
  get: () => PlayerState,
): Promise<void> {
  const { activeSessionId, currentIndex, isDrafting } = get();
  if (!activeSessionId || !djEngine || isDrafting) return;
  set({ isDrafting: true });
  try {
    const refilled = await djEngine.refillIfNeeded(activeSessionId, currentIndex);
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

import { liveQuery, type Subscription } from "dexie";
import { create } from "zustand";
import { db } from "@/db/muzero-db";
import {
  appendTrackIds,
  createUploadedTrack,
  getSession,
  getSettings,
  getTrackBlob,
  getTracksByIds,
  incrementPlayCount,
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
import { clampIndex, nextIndex, prevIndex, type RepeatMode } from "@/player/queue";

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
  setDisplayMode: (mode: SetDisplayMode) => Promise<void>;
  setAudioOnly: (audioOnly: boolean) => void;
  /** Import uploaded audio/video files into the active set. */
  addUploads: (files: FileList | File[]) => Promise<void>;
  /** Manually ask the DJ to draft more now. */
  draftNow: () => Promise<void>;
}

// Non-reactive singletons (never selected by components → no rerenders).
let mediaEngine: MediaEngine | null = null;

/** Access the shared media engine (for the stage to mount + the visualizer). */
export function getMediaEngine(): MediaEngine | null {
  return mediaEngine;
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
      onEnded: () => void get().next(),
      onTimeUpdate: (positionSec, durationSec) => set({ positionSec, durationSec }),
      onPlayStateChange: (isPlaying) => set({ isPlaying }),
      onError: (msg) => set({ djError: msg }),
    });
    mediaEngine.setVolume(get().volume);
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

    const session = await getSession(sessionId);
    const initialQueue = session ? await getTracksByIds(session.trackIds) : [];
    loadedTrackId = null;
    set({
      activeSessionId: sessionId,
      queue: initialQueue,
      currentIndex: -1,
      wantPlay: false,
      displayMode: session?.displayMode ?? "video",
      djEnabled: session?.config.autoExtend ?? false,
    });
    await saveSettings({ lastSessionId: sessionId });

    // Stream generation progress into state as it lands.
    queueSub = liveQuery(async () => {
      const s = await getSession(sessionId);
      if (!s) return [] as Track[];
      return getTracksByIds(s.trackIds);
    }).subscribe({
      next: (queue) => {
        set({ queue });
        void afterQueueUpdate(set, get);
      },
      error: (err) => log.error("player", "queue subscription error", err),
    });

    // Seed an empty DJ set with a first batch.
    if (session?.config.autoExtend && session.trackIds.length === 0) void get().draftNow();
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
    if (positionSec > 3) {
      get().seek(0);
      return;
    }
    const pi = prevIndex(queue.length, currentIndex, repeat);
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
      await appendTrackIds(activeSessionId, ids);
      log.info("player", `uploaded ${ids.length} file(s)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ djError: msg });
      log.error("player", "upload failed", msg);
    } finally {
      set({ isUploading: false });
    }
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
  const { activeSessionId, currentIndex, isDrafting, djEnabled } = get();
  if (!activeSessionId || !djEngine || isDrafting || !djEnabled) return;
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

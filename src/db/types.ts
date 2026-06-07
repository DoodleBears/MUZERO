import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { CloudPresetId } from "@/musicgen/presets";
import type { MusicGenProviderId } from "@/musicgen/registry";
import type { VisualizerStyleId } from "@/visualizer/types";

/** Lifecycle of a single track. Uploaded tracks are born "ready". */
export type TrackStatus = "pending" | "generating" | "ready" | "failed";

/** Playback type. A set can mix both freely. */
export type TrackKind = "audio" | "video";

/** Where the track came from. */
export type TrackOrigin = "generated" | "uploaded";

/**
 * A track in a set — either an AI-generated song or a user-uploaded audio/video
 * (YouTube-Music-style MV). The audio/video bytes and any cover image live in
 * the separate `mediaBlobs` table so list queries stay light.
 */
export interface Track {
  id: string;
  sessionId: string;
  title: string;
  kind: TrackKind;
  origin: TrackOrigin;
  /** Generated tracks only — the DJ brief that produced it. */
  brief?: TrackBrief;
  /** Provider id for generated tracks; "upload" for uploaded ones. */
  provider: string;
  status: TrackStatus;
  /** Duration in seconds. */
  durationSec: number;
  /** FK into `mediaBlobs` for the audio/video bytes. */
  blobId?: string;
  /** Optional cover image (memory photo / artwork) — FK into `mediaBlobs`. */
  coverBlobId?: string;
  /** Non-destructive square crop for the cover, in the original image's pixels. */
  coverCrop?: CropRect;
  error?: string;
  createdAt: number;
  generatedAt?: number;
  playCount: number;
  liked: boolean;
  // Annotations — "music carries memories": user labels + a freeform note.
  tags: string[];
  note?: string;
}

/**
 * Audio, video, or image bytes, kept out of the hot `tracks` table.
 *  - `media`   — the audio/video itself
 *  - `cover`   — a single cover image per track
 *  - `background` — per-track slideshow background images (many per track)
 *  - `gallery` — global slideshow images, stored under the sentinel
 *    `trackId === GLOBAL_GALLERY_ID` (not bound to any track)
 * New roles are additive: existing rows keep their role, so no schema bump.
 */
export interface MediaBlob {
  id: string;
  trackId: string;
  role: "media" | "cover" | "background" | "gallery";
  mime: string;
  bytes: number;
  blob: Blob;
}

/**
 * 播放列表 Play Queue — the actual playback order the player consumes, DECOUPLED
 * from any 歌单(Set/`DjSession`). You load a set's tracks into it, push tracks
 * ("play next" / "add to queue"), remove, reorder; it loops. One global singleton.
 * Entries carry their own id so the same track can appear more than once and
 * reorder has stable keys.
 */
export interface PlayQueueEntry {
  id: string; // newId("pqe")
  trackId: string;
}

export interface PlayQueue {
  id: "main"; // singleton
  entries: PlayQueueEntry[];
  currentIndex: number;
  repeat: "off" | "one" | "all";
  /** Which 歌单 we're "playing from" — drives autoExtend continuation + UI. */
  contextSetId?: string;
  updatedAt: number;
}

/** Where the Now-Playing ambient background pulls its image(s) from. */
export type BackgroundMode = "cover" | "slideshow";

/**
 * A square crop region in the original image's pixels. Stored non-destructively
 * (Poweramp-style): the full image stays in `mediaBlobs`; this only records what
 * to show, and a setting decides whether covers render cropped or full.
 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** How a set renders the "stage" while playing. */
export type SetDisplayMode = "video" | "cover" | "title";

/**
 * A set: an ordered, mixed list of tracks. The DJ can keep it growing
 * (`config.autoExtend` + a `seedPrompt`), or it can be a hand-curated/upload set.
 */
export interface DjSession {
  id: string;
  name: string;
  /** Free-text description shown on the set detail page. */
  description?: string;
  /** The DJ vibe/seed. Empty for a pure upload set. */
  seedPrompt: string;
  /**
   * Set-level cover — FK into `mediaBlobs` (role "cover", `trackId` = this set id).
   * When unset, the UI falls back to the topmost (newest) track's cover.
   */
  coverBlobId?: string;
  /** Ordered, curated members. Newest is PREPENDED to the front (= the cover). */
  trackIds: string[];
  status: "idle" | "running";
  config: DjConfig;
  /** Default stage rendering: video-first → cover → title. */
  displayMode: SetDisplayMode;
  createdAt: number;
  updatedAt: number;
}

/** Per-set DJ behavior. */
export interface DjConfig {
  /** Whether the DJ keeps generating audio to fill this set. */
  autoExtend: boolean;
  /** Auto-extend when fewer than this many upcoming tracks remain. */
  refillThreshold: number;
  /** How many tracks the DJ drafts per refill. */
  batchSize: number;
  /** Default target track length the DJ aims for (seconds). */
  targetDurationSec: number;
  /** Allow vocals, or instrumental-only. */
  allowVocals: boolean;
}

export const DEFAULT_DJ_CONFIG: DjConfig = {
  autoExtend: true,
  refillThreshold: 2,
  batchSize: 1,
  targetDurationSec: 60,
  allowVocals: true,
};

export type LlmProviderId = "openai" | "anthropic";

/** Singleton app settings (id = "app"). BYOK keys stay on-device, never bundled. */
export interface AppSettings {
  id: "app";
  // LLM DJ (Vercel AI SDK)
  llmProvider: LlmProviderId;
  llmModel: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  // Music generation (BYOK cloud API; "mock" needs no config)
  musicGenProvider: MusicGenProviderId;
  /** Which cloud vendor preset drives the "cloud" provider. Defaults to mureka. */
  musicCloudPreset?: CloudPresetId;
  musicCloudUrl?: string;
  musicCloudApiKey?: string;
  musicCloudModel?: string;
  // UI
  locale: "en" | "zh" | "ja" | "ko";
  /** Now-Playing background *priority*: prefer the track's own cover or its bound slideshow. Defaults to "cover". */
  backgroundMode?: BackgroundMode;
  /** When a track has neither its own slideshow nor a cover, fall back to the global gallery slideshow. Default true. */
  backgroundGalleryFallback?: boolean;
  /** Auto-hide the header + dock on Now Playing after idle (immersive). Default true. */
  immersiveIdle?: boolean;
  /** Render covers using their stored crop (vs the full image). Default true. */
  coverCropped?: boolean;
  /** Now-Playing background blur radius in px. Default 12. */
  backgroundBlur?: number;
  /** Now-Playing background dim/mask opacity, 0–100. Default 25. */
  backgroundMaskOpacity?: number;
  /** Slideshow auto-advance interval in seconds. Default 300 (5 min). */
  backgroundSlideshowIntervalSec?: number;
  /** Slideshow advances in random order vs sequential. Default true (random). */
  backgroundSlideshowShuffle?: boolean;
  /** Now-Playing visualizer style. Defaults to "aura" (the original bloom). */
  visualizerStyle?: VisualizerStyleId;
  /** Use the visualizer as the full Now-Playing background (vs the image slideshow). Default false. */
  visualizerAsBackground?: boolean;
  /** Global color scheme. Mirrors localStorage `muzero-theme`; defaults to system. */
  theme?: "light" | "dark" | "system";
  /** Primary/accent color (hex) for light mode. Mirrors localStorage `muzero-primary-light`. */
  primaryLight?: string;
  /** Primary/accent color (hex) for dark mode. Mirrors localStorage `muzero-primary-dark`. */
  primaryDark?: string;
  /** UI font-family stack. Mirrors localStorage `muzero-font`; unset = system default. */
  fontFamily?: string;
  /** Persisted resume point: last active session + index. */
  lastSessionId?: string;
  lastTrackIndex?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  musicGenProvider: "mock",
  musicCloudPreset: "mureka",
  locale: "en",
  theme: "system",
  backgroundMode: "cover",
  backgroundGalleryFallback: true,
  immersiveIdle: true,
  coverCropped: true,
  backgroundBlur: 12,
  backgroundMaskOpacity: 25,
  backgroundSlideshowIntervalSec: 300,
  backgroundSlideshowShuffle: true,
  visualizerStyle: "aura",
  visualizerAsBackground: false,
};

import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { CloudPresetId } from "@/musicgen/presets";
import type { MusicGenProviderId } from "@/musicgen/registry";

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
  error?: string;
  createdAt: number;
  generatedAt?: number;
  playCount: number;
  liked: boolean;
  // Annotations — "music carries memories": user labels + a freeform note.
  tags: string[];
  note?: string;
}

/** Audio, video, or cover-image bytes, kept out of the hot `tracks` table. */
export interface MediaBlob {
  id: string;
  trackId: string;
  /** What the bytes are, so we don't confuse a cover with the media. */
  role: "media" | "cover";
  mime: string;
  bytes: number;
  blob: Blob;
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
  /** The DJ vibe/seed. Empty for a pure upload set. */
  seedPrompt: string;
  /** Ordered track ids = the playable queue. */
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
  /** Which cloud vendor preset drives the "cloud" provider. Defaults to ace-step. */
  musicCloudPreset?: CloudPresetId;
  musicCloudUrl?: string;
  musicCloudApiKey?: string;
  musicCloudModel?: string;
  // UI
  locale: "en" | "zh" | "ja" | "ko";
  /** Persisted resume point: last active session + index. */
  lastSessionId?: string;
  lastTrackIndex?: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: "app",
  llmProvider: "openai",
  llmModel: "gpt-4o-mini",
  musicGenProvider: "mock",
  locale: "en",
};

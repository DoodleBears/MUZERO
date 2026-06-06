import type { TrackBrief } from "@/dj/dj-brief-schema";
import type { MusicGenProviderId } from "@/musicgen/registry";

/** Lifecycle of a single generated track. */
export type TrackStatus = "pending" | "generating" | "ready" | "failed";

/**
 * A song the DJ produced. The audio bytes live in a separate `mediaBlobs` row so
 * `tracks` queries (the virtualized library / queue) stay light — we never pull
 * megabytes of WAV into memory just to render a list.
 */
export interface Track {
  id: string;
  sessionId: string;
  title: string;
  brief: TrackBrief;
  provider: string;
  status: TrackStatus;
  /** Duration in seconds (brief estimate until `ready`, then actual). */
  durationSec: number;
  /** FK into `mediaBlobs` once generated. */
  blobId?: string;
  error?: string;
  createdAt: number;
  generatedAt?: number;
  playCount: number;
  liked: boolean;
}

/** Audio bytes, kept out of the hot `tracks` table. */
export interface MediaBlob {
  id: string;
  trackId: string;
  mime: string;
  bytes: number;
  blob: Blob;
}

/** A continuous DJ run: a vibe/seed plus the ordered queue it's building. */
export interface DjSession {
  id: string;
  name: string;
  /** The user's seed instruction, e.g. "late-night lo-fi for coding". */
  seedPrompt: string;
  /** Ordered track ids = the playable queue. Newest DJ picks appended at the end. */
  trackIds: string[];
  status: "idle" | "running";
  config: DjConfig;
  createdAt: number;
  updatedAt: number;
}

/** Per-session DJ behavior. */
export interface DjConfig {
  /** Auto-extend the queue when fewer than this many upcoming tracks remain. */
  refillThreshold: number;
  /** How many tracks the DJ drafts per refill. */
  batchSize: number;
  /** Default target track length the DJ aims for (seconds). */
  targetDurationSec: number;
  /** Allow vocals, or instrumental-only. */
  allowVocals: boolean;
}

export const DEFAULT_DJ_CONFIG: DjConfig = {
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
  // Music generation
  musicGenProvider: MusicGenProviderId;
  aceStepUrl: string;
  aceStepSynthModel?: string;
  aceStepLmModel?: string;
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
  aceStepUrl: "http://localhost:8085",
  locale: "en",
};

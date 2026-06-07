import type { TrackBrief } from "@/dj/dj-brief-schema";

/**
 * MusicGenProvider — the pluggable boundary between the AI DJ and whatever
 * actually renders audio. MUZERO ships:
 *  - `mock`  — synthesizes a tone locally (dev + tests, no model, no network)
 *  - `cloud` — BYOK cloud API (Replicate / ElevenLabs Music / Suno-style / …),
 *              async submit→poll→download; see `cloud-provider.ts`
 *
 * Add more providers by implementing this interface and registering it. The DJ
 * never knows which one it's talking to — it only writes a provider-agnostic
 * TrackBrief.
 */

export interface MusicGenRequest {
  brief: TrackBrief;
  /** Abort an in-flight generation (queue cleared, app closing, …). */
  signal?: AbortSignal;
  /** Optional progress callback in [0, 1]; providers may not report it. */
  onProgress?: (fraction: number) => void;
}

export interface MusicGenResult {
  /** The rendered audio. */
  blob: Blob;
  /** MIME type, e.g. "audio/wav". */
  mime: string;
  /** Actual decoded duration in seconds (may differ from requested). */
  durationSec: number;
  /** The provider id that produced it. */
  provider: string;
}

export interface MusicGenProvider {
  readonly id: string;
  readonly label: string;
  /** Display/provenance key for the concrete vendor/model used by this provider. */
  readonly providerPreset?: string;
  /** Whether this provider needs the user to configure an endpoint / API key. */
  readonly requiresConfig: boolean;
  generate(req: MusicGenRequest): Promise<MusicGenResult>;
  /** Best-effort reachability check for the Settings screen. */
  health?(): Promise<boolean>;
}

export class MusicGenError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MusicGenError";
  }
}

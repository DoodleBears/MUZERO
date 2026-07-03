/**
 * TtsPlayback — serializes the DJ's spoken replies through a dedicated audio sink
 * and ducks the music while it speaks. A module-scope orchestration unit (not
 * Zustand state — CLAUDE.md rule 6). All I/O (synthesis, the audio sink, the
 * music ducker, object-URL lifecycle) is injected so queueing + ducking +
 * revoke-before-replace are deterministically unit-testable without real audio.
 *
 * Ducking is batch-level: the music dips once when a run of replies starts and
 * restores when the queue drains, so consecutive replies don't bounce the volume.
 * (The gradient/ramped duck is layered on in Phase 3 via the injected ducker.)
 */

import { createDiagnosticLogger } from "@/lib/logger";
import type { TtsResult } from "@/tts/provider";

const diag = createDiagnosticLogger("voice.tts");

export interface TtsPlaybackSink {
  /** Play one clip; resolves when it finishes (or errors). */
  play(url: string): Promise<void>;
  stop(): void;
}

export interface MusicDucker {
  duck(targetVolume: number): void;
  restore(): void;
}

export interface TtsPlaybackConfig {
  duckEnabled: boolean;
  duckVolume: number;
}

export interface TtsPlaybackDeps {
  synthesize: (text: string, signal?: AbortSignal) => Promise<TtsResult>;
  sink: TtsPlaybackSink;
  ducker: MusicDucker;
  getConfig: () => TtsPlaybackConfig;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  onError?: (err: unknown) => void;
}

export interface TtsPlayback {
  /** Enqueue a reply line for speaking (serialized). */
  speak(text: string): void;
  /** Cancel the queue + current clip and restore the music. */
  stop(): void;
  isSpeaking(): boolean;
}

export function createTtsPlayback(deps: TtsPlaybackDeps): TtsPlayback {
  const createUrl = deps.createObjectUrl ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revokeUrl = deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));

  const queue: string[] = [];
  let running = false;
  let ducked = false;
  let cancelled = false;
  let lastUrl: string | null = null;

  function revokeLast(): void {
    if (lastUrl) {
      revokeUrl(lastUrl);
      lastUrl = null;
    }
  }

  async function run(): Promise<void> {
    running = true;
    const config = deps.getConfig();
    if (config.duckEnabled) {
      deps.ducker.duck(config.duckVolume);
      ducked = true;
    }
    while (queue.length > 0 && !cancelled) {
      const text = queue.shift();
      if (!text) continue;
      try {
        const result = await deps.synthesize(text);
        if (cancelled) break;
        const url = createUrl(result.blob);
        revokeLast(); // revoke-before-replace (rule 9)
        lastUrl = url;
        await deps.sink.play(url);
      } catch (err) {
        diag.warn("speak-failed", { message: (err as Error)?.name });
        deps.onError?.(err);
      }
    }
    revokeLast();
    if (ducked) {
      deps.ducker.restore();
      ducked = false;
    }
    running = false;
    // A speak() that arrived during the closing frame re-arms the runner.
    if (queue.length > 0 && !cancelled) void run();
  }

  return {
    speak(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;
      cancelled = false;
      queue.push(trimmed);
      if (!running) void run();
    },
    stop() {
      cancelled = true;
      queue.length = 0;
      deps.sink.stop();
      revokeLast();
      if (ducked) {
        deps.ducker.restore();
        ducked = false;
      }
      running = false;
    },
    isSpeaking: () => running,
  };
}

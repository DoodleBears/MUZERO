/**
 * Production wiring for the TTS playback path: synthesize with the current
 * settings, a dedicated `<audio>` sink, and a MediaEngine-backed music ducker.
 * Kept apart from the pure `tts-playback.ts` engine so the engine's tests stay
 * free of DOM/audio/store globals. The reply→speak singleton is assembled in
 * Phase 3 (it needs live duck config); Phase 2 uses `synthesizeReply` for the
 * Settings "Preview reply" button and exposes the sink/ducker for reuse.
 */

import { getSettings } from "@/db/repositories";
import { getMediaEngine, usePlayerStore } from "@/stores/player-store";
import { TtsError, type TtsResult } from "@/tts/provider";
import { resolveTtsProvider } from "@/tts/registry";
import type { MusicDucker, TtsPlaybackSink } from "./tts-playback";

/** Synthesize a reply line with the configured provider/voice/speed. */
export async function synthesizeReply(
  text: string,
  opts: { voiceId?: string; signal?: AbortSignal } = {},
): Promise<TtsResult> {
  const settings = await getSettings();
  const provider = resolveTtsProvider(settings);
  const providerId = settings.ttsProvider ?? "fish-audio";
  if (!provider) throw new TtsError("Text-to-speech is not configured.", "auth", providerId);
  const voiceId = opts.voiceId ?? settings.ttsVoiceId;
  if (!voiceId) throw new TtsError("No voice selected.", "unknown", providerId);
  return provider.synthesize({ text, voiceId, speed: settings.ttsSpeed, signal: opts.signal });
}

/** A dedicated `<audio>` element sink (separate from the music element). */
export function createAudioSink(): TtsPlaybackSink {
  const el = typeof Audio !== "undefined" ? new Audio() : null;
  return {
    play(url: string): Promise<void> {
      return new Promise<void>((resolve) => {
        if (!el) {
          resolve();
          return;
        }
        const done = () => {
          el.removeEventListener("ended", done);
          el.removeEventListener("error", done);
          resolve();
        };
        el.addEventListener("ended", done);
        el.addEventListener("error", done);
        el.src = url;
        void el.play().catch(() => done());
      });
    },
    stop() {
      if (!el) return;
      el.pause();
      el.removeAttribute("src");
      el.load();
    },
  };
}

/**
 * Duck the music element while the DJ speaks, restoring to the user's configured
 * volume afterward. Writes the element volume directly (not the persisted store
 * value), so the user's saved volume is never overwritten by a duck.
 */
export function createMediaEngineDucker(): MusicDucker {
  return {
    duck(target: number) {
      getMediaEngine()?.setVolume(target);
    },
    restore() {
      getMediaEngine()?.setVolume(usePlayerStore.getState().volume);
    },
  };
}

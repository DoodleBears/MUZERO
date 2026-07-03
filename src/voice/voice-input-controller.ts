/**
 * VoiceInputController — the microphone-capture state machine behind push-to-talk.
 * A module-scope singleton (NOT Zustand state — CLAUDE.md rule 6), same discipline
 * as `AudioEngine` / `DjEngine`. Recording primitives and transcription are all
 * injected so the whole `idle → recording → transcribing → idle` flow is
 * deterministically unit-testable without a real microphone or network (mirrors
 * anysoul's `use-voice-input.ts`, but framework-agnostic).
 */

import type { AsrResult } from "@/asr/provider";
import { createDiagnosticLogger } from "@/lib/logger";

const diag = createDiagnosticLogger("voice.input");

/** Below this, a recording is treated as silence / a mis-press and dropped. */
const MIN_BLOB_BYTES = 1000;

/** MIME types we prefer for recording, best first (mirrors anysoul). */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/ogg",
  "audio/mp4",
];

/** Pick the first supported MIME type; "" tells `MediaRecorder` to choose. */
export function pickSupportedMimeType(isSupported: (mime: string) => boolean): string {
  for (const mime of PREFERRED_MIME_TYPES) {
    if (isSupported(mime)) return mime;
  }
  return "";
}

export type VoiceInputState = "idle" | "recording" | "transcribing";

/** The slice of `MediaRecorder` the controller uses (injectable for tests). */
export interface MediaRecorderLike {
  readonly state: string;
  readonly mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror?: ((event: unknown) => void) | null;
}

export interface MediaStreamLike {
  getTracks(): Array<{ stop(): void }>;
}

export interface VoiceInputCallbacks {
  onStateChange?: (state: VoiceInputState) => void;
  onTranscript?: (text: string, result: AsrResult) => void;
  onError?: (error: unknown) => void;
}

export interface VoiceInputDeps {
  getMedia: (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;
  createRecorder: (stream: MediaStreamLike, options: { mimeType?: string }) => MediaRecorderLike;
  pickMimeType: () => string;
  transcribe: (blob: Blob, opts: { signal?: AbortSignal }) => Promise<AsrResult>;
  /** Preferred microphone `deviceId`, if any. */
  getDeviceId?: () => string | undefined;
  /** Register a focus-loss handler; returns an unsubscribe fn. */
  onBlur?: (handler: () => void) => () => void;
  minBlobBytes?: number;
  callbacks?: VoiceInputCallbacks;
}

export interface VoiceInputController {
  getState(): VoiceInputState;
  start(): Promise<void>;
  stop(): Promise<AsrResult | null>;
  cancel(): void;
  /** hold: down=start / up=stop. toggle: press flips idle↔recording. */
  toggle(): Promise<void>;
  /** Dev/test seam: feed a transcript straight into the pipeline as if the ASR
   *  produced it (no microphone). Fires the same `onTranscript` wiring a real
   *  recording would. Only acts when idle. */
  injectTranscript(text: string): void;
  setCallbacks(callbacks: VoiceInputCallbacks): void;
  dispose(): void;
}

export function createVoiceInputController(deps: VoiceInputDeps): VoiceInputController {
  const minBlobBytes = deps.minBlobBytes ?? MIN_BLOB_BYTES;
  let callbacks = deps.callbacks ?? {};
  let state: VoiceInputState = "idle";
  let recorder: MediaRecorderLike | null = null;
  let stream: MediaStreamLike | null = null;
  let chunks: Blob[] = [];
  let abort: AbortController | null = null;
  // Set true by cancel()/focus-loss so a stop-in-flight discards its audio.
  let cancelled = false;

  const unsubscribeBlur =
    deps.onBlur?.(() => {
      if (state === "recording") cancel();
    }) ?? (() => {});

  function setState(next: VoiceInputState): void {
    state = next;
    callbacks.onStateChange?.(next);
  }

  function releaseStream(): void {
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    recorder = null;
    chunks = [];
  }

  async function start(): Promise<void> {
    if (state !== "idle") return; // debounce double-press / mid-transcription
    cancelled = false;
    abort = new AbortController();
    let media: MediaStreamLike;
    try {
      const deviceId = deps.getDeviceId?.();
      media = await deps.getMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
    } catch (err) {
      diag.warn("mic-open-failed", { message: (err as Error)?.name });
      releaseStream();
      callbacks.onError?.(err);
      return;
    }
    // A cancel()/blur may have fired while awaiting the mic prompt.
    if (cancelled) {
      for (const track of media.getTracks()) track.stop();
      return;
    }
    stream = media;
    const mimeType = deps.pickMimeType();
    recorder = deps.createRecorder(stream, mimeType ? { mimeType } : {});
    chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.start();
    setState("recording");
  }

  function stop(): Promise<AsrResult | null> {
    if (state !== "recording" || !recorder) return Promise.resolve(null);
    const activeRecorder = recorder;
    return new Promise<AsrResult | null>((resolve) => {
      activeRecorder.onstop = () => {
        const mimeType = activeRecorder.mimeType || "audio/webm";
        const blob = new Blob(chunks, { type: mimeType });
        releaseStream();
        if (cancelled) {
          setState("idle");
          resolve(null);
          return;
        }
        if (blob.size < minBlobBytes) {
          diag.debug("dropped-short", { bytes: blob.size });
          setState("idle");
          resolve(null);
          return;
        }
        setState("transcribing");
        void transcribeBlob(blob).then(resolve);
      };
      activeRecorder.stop();
    });
  }

  async function transcribeBlob(blob: Blob): Promise<AsrResult | null> {
    try {
      const result = await deps.transcribe(blob, { signal: abort?.signal });
      if (cancelled) return null;
      const text = result.text.trim();
      if (text) callbacks.onTranscript?.(text, result);
      return text ? result : null;
    } catch (err) {
      callbacks.onError?.(err);
      return null;
    } finally {
      setState("idle");
    }
  }

  function cancel(): void {
    cancelled = true;
    abort?.abort();
    if (recorder && recorder.state !== "inactive") {
      // Detach onstop so the pending stop() promise doesn't transcribe.
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // ignore — already stopping
      }
    }
    releaseStream();
    if (state !== "idle") setState("idle");
  }

  async function toggle(): Promise<void> {
    if (state === "idle") return start();
    if (state === "recording") {
      await stop();
    }
    // transcribing → ignore
  }

  return {
    getState: () => state,
    start,
    stop,
    cancel,
    toggle,
    injectTranscript: (text) => {
      const clean = text.trim();
      if (state !== "idle" || !clean) return;
      callbacks.onTranscript?.(clean, { text: clean });
    },
    setCallbacks: (next) => {
      callbacks = next;
    },
    dispose: () => {
      unsubscribeBlur();
      cancel();
    },
  };
}

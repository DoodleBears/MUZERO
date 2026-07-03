/**
 * Production wiring for {@link createVoiceInputController}: real `getUserMedia` /
 * `MediaRecorder`, and a `transcribe` that resolves the active ASR provider from
 * live settings each call (so a key/model/language change takes effect without
 * rebuilding the controller). Kept apart from the controller so the controller's
 * unit tests stay free of DOM/media globals.
 */

import { AsrError, type AsrResult } from "@/asr/provider";
import { resolveAsrProvider } from "@/asr/registry";
import { getSettings } from "@/db/repositories";
import {
  createVoiceInputController,
  type MediaRecorderLike,
  pickSupportedMimeType,
  type VoiceInputController,
  type VoiceInputDeps,
} from "./voice-input-controller";

/** Transcribe a blob with whatever ASR provider the current settings resolve to. */
export async function transcribeWithSettings(
  blob: Blob,
  opts: { signal?: AbortSignal },
): Promise<AsrResult> {
  const settings = await getSettings();
  const provider = resolveAsrProvider(settings);
  if (!provider) {
    throw new AsrError("Speech input is not configured.", "auth", settings.asrProvider ?? "groq");
  }
  const language =
    settings.asrLanguage && settings.asrLanguage !== "auto" ? settings.asrLanguage : undefined;
  return provider.transcribe({ blob, language, signal: opts.signal });
}

function defaultPickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return pickSupportedMimeType((mime) => MediaRecorder.isTypeSupported(mime));
}

/** Focus-loss subscription: cancel an in-flight recording when the window/tab hides. */
function subscribeBlur(handler: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "hidden") handler();
  };
  window.addEventListener("blur", handler);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("blur", handler);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/** Build production controller deps, allowing tests / the mic-test block to override. */
export function defaultVoiceInputDeps(overrides: Partial<VoiceInputDeps> = {}): VoiceInputDeps {
  return {
    getMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    // The DOM `MediaRecorder` types its events more richly than the injectable
    // slice the controller consumes; the structural shape is compatible.
    createRecorder: (stream, options) =>
      new MediaRecorder(stream as MediaStream, options) as unknown as MediaRecorderLike,
    pickMimeType: defaultPickMimeType,
    transcribe: transcribeWithSettings,
    onBlur: subscribeBlur,
    ...overrides,
  };
}

let singleton: VoiceInputController | null = null;

/**
 * The app-wide push-to-talk controller (Phase 3 wiring binds its callbacks). The
 * Settings mic-test block creates its OWN short-lived instance instead of sharing
 * this one, so the two consumers never fight over callbacks.
 */
export function getVoiceInputController(): VoiceInputController {
  if (!singleton) singleton = createVoiceInputController(defaultVoiceInputDeps());
  return singleton;
}

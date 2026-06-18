import { log } from "@/lib/logger";
import { isMediabunnySupportedContentType } from "@/lib/media-container-format";
import {
  candidatePosterTimes,
  scoreImagePixels,
  selectBestScoredFrame,
  type VideoFrameCandidate,
  type VideoFrameScore,
} from "@/lib/video-frame-score";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_MAX_HEIGHT = 960;
const POSTER_MIME = "image/webp";
const POSTER_QUALITY = 0.85;
const ANALYSIS_SIZE = 64;

export type ExtractedVideoPosterFrame = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  atTimeSeconds: number;
  source: "mediabunny" | "native-video";
  score: VideoFrameScore;
};

export type VideoPosterFrameOptions = {
  durationSec?: number;
  maxWidth?: number;
  maxHeight?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type CapturedVideoPosterFrame = Omit<ExtractedVideoPosterFrame, "source">;

/**
 * Extract a useful poster frame for an uploaded video. Phase 1 implements the
 * native <video> path; Phase 2 wires mediabunny into the catch branch.
 */
export async function extractUsefulVideoPosterFrame(
  file: File,
  options: VideoPosterFrameOptions = {},
): Promise<ExtractedVideoPosterFrame | null> {
  if (typeof document === "undefined") return null;
  try {
    const frames = await extractVideoFramesBatchViaVideoElement(
      file,
      candidatePosterTimes(options.durationSec),
      options,
    );
    const best = selectBestScoredFrame(frames);
    return best ? { ...best, source: "native-video" } : null;
  } catch (error) {
    if (isAbortError(error)) throw error;
    const fallback = await extractViaMediabunnyFallback(file, options);
    if (fallback) return fallback;
    log.debug("video-poster", "native poster extraction failed", {
      error: error instanceof Error ? error.name : typeof error,
      mime: file.type || undefined,
      size: file.size,
    });
    return null;
  }
}

export async function extractVideoFramesBatchViaVideoElement(
  file: File,
  requests: readonly VideoFrameCandidate[],
  options: VideoPosterFrameOptions = {},
): Promise<CapturedVideoPosterFrame[]> {
  if (requests.length === 0 || typeof document === "undefined") return [];

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  video.src = objectUrl;

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const frames: CapturedVideoPosterFrame[] = [];

  try {
    throwIfAborted(options.signal);
    await waitForVideoEvent(video, "loadedmetadata", timeoutMs, options.signal);
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Video metadata is missing dimensions.");
    }

    const canvas = document.createElement("canvas");
    const scale = Math.min(
      1,
      (options.maxWidth ?? DEFAULT_MAX_WIDTH) / video.videoWidth,
      (options.maxHeight ?? DEFAULT_MAX_HEIGHT) / video.videoHeight,
    );
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    const safeDuration =
      Number.isFinite(video.duration) && video.duration > 0 ? video.duration : options.durationSec;

    for (const request of requests) {
      throwIfAborted(options.signal);
      const atTimeSeconds = clampSeekTime(request.atTimeSeconds, safeDuration);
      await seekVideo(video, atTimeSeconds, timeoutMs, options.signal);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const score = scoreCanvas(canvas);
      const blob = await canvasToBlob(canvas, POSTER_MIME, POSTER_QUALITY);
      frames.push({
        atTimeSeconds,
        blob,
        height: canvas.height,
        mime: POSTER_MIME,
        score,
        width: canvas.width,
      });
    }

    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(objectUrl);
  }
}

async function extractViaMediabunnyFallback(
  file: File,
  options: VideoPosterFrameOptions,
): Promise<ExtractedVideoPosterFrame | null> {
  if (!isMediabunnySupportedContentType(file.type, file.name)) return null;
  const { extractVideoFramesBatchViaMediabunny } = await import("@/lib/media-mediabunny-frames");
  const frames = await extractVideoFramesBatchViaMediabunny(
    file,
    candidatePosterTimes(options.durationSec),
    options,
  );
  const best = frames ? selectBestScoredFrame(frames) : null;
  return best ? { ...best, source: "mediabunny" } : null;
}

function clampSeekTime(value: number, durationSec: number | undefined): number {
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return safeValue;
  }
  return Math.max(0, Math.min(safeValue, Math.max(0, durationSec - 0.01)));
}

async function seekVideo(
  video: HTMLVideoElement,
  atTimeSeconds: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (atTimeSeconds <= 0.001) {
    video.currentTime = 0;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await waitForVideoEvent(video, "loadeddata", timeoutMs, signal);
    }
    return;
  }
  video.currentTime = atTimeSeconds;
  await waitForVideoEvent(video, "seeked", timeoutMs, signal);
}

function scoreCanvas(canvas: HTMLCanvasElement): VideoFrameScore {
  const analysis = document.createElement("canvas");
  analysis.width = ANALYSIS_SIZE;
  analysis.height = ANALYSIS_SIZE;
  const context = analysis.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.drawImage(canvas, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  return scoreImagePixels(context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE));
}

function waitForVideoEvent(
  video: HTMLVideoElement,
  eventName: "loadeddata" | "loadedmetadata" | "seeked",
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      window.clearTimeout(timeoutId);
    };
    const finish = (fn: () => void) => {
      cleanup();
      fn();
    };
    const onEvent = () => finish(resolve);
    const onError = () =>
      finish(() =>
        reject(new Error(`Video failed to ${eventName === "seeked" ? "seek" : "load"}.`)),
      );
    const onAbort = () => finish(() => reject(abortError()));
    const timeoutId = window.setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for video ${eventName}.`)));
    }, timeoutMs);

    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not create video poster image."));
          return;
        }
        resolve(blob);
      },
      mime,
      quality,
    );
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("Video poster extraction aborted.");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

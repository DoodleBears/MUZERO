import { BlobSource, CanvasSink, Input } from "mediabunny";
import { MEDIABUNNY_INPUT_FORMATS } from "@/lib/media-mediabunny-formats";
import { scoreImagePixels, type VideoFrameCandidate } from "@/lib/video-frame-score";
import type { CapturedVideoPosterFrame, VideoPosterFrameOptions } from "@/lib/video-poster-frame";

const MEDIABUNNY_SOURCE_CACHE_BYTES = 8 * 2 ** 20;
const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_MAX_HEIGHT = 960;
const POSTER_MIME = "image/webp";
const POSTER_QUALITY = 0.85;
const ANALYSIS_SIZE = 64;

export async function extractVideoFramesBatchViaMediabunny(
  file: File,
  requests: readonly VideoFrameCandidate[],
  options: VideoPosterFrameOptions = {},
): Promise<CapturedVideoPosterFrame[] | null> {
  if (requests.length === 0) return [];

  let input: Input | null = null;
  try {
    const source = new BlobSource(file, { maxCacheSize: MEDIABUNNY_SOURCE_CACHE_BYTES });
    input = new Input({ formats: MEDIABUNNY_INPUT_FORMATS, source });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    if (!(await track.canDecode())) return null;

    const sink = new CanvasSink(track, { poolSize: 2 });
    const frames: CapturedVideoPosterFrame[] = [];
    for (const request of requests) {
      throwIfAborted(options.signal);
      const wrapped = await sink.getCanvas(Math.max(0, request.atTimeSeconds));
      if (!wrapped) continue;
      frames.push(await encodeWrappedCanvas(wrapped.canvas, request.atTimeSeconds, options));
    }
    return frames;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  } finally {
    try {
      await input?.dispose?.();
    } catch {
      // best-effort
    }
  }
}

async function encodeWrappedCanvas(
  source: HTMLCanvasElement | OffscreenCanvas,
  atTimeSeconds: number,
  options: VideoPosterFrameOptions,
): Promise<CapturedVideoPosterFrame> {
  const scale = Math.min(
    1,
    (options.maxWidth ?? DEFAULT_MAX_WIDTH) / source.width,
    (options.maxHeight ?? DEFAULT_MAX_HEIGHT) / source.height,
  );
  const canvas = makeCanvas(
    Math.max(1, Math.round(source.width * scale)),
    Math.max(1, Math.round(source.height * scale)),
  );
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source as CanvasImageSource, 0, 0, canvas.width, canvas.height);

  const score = scoreCanvas(canvas);
  const blob = await canvasToBlob(canvas, POSTER_MIME, POSTER_QUALITY);
  return {
    atTimeSeconds,
    blob,
    height: canvas.height,
    mime: POSTER_MIME,
    score,
    width: canvas.width,
  };
}

function scoreCanvas(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const analysis = makeCanvas(ANALYSIS_SIZE, ANALYSIS_SIZE);
  const context = analysis.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  context.drawImage(canvas, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  return scoreImagePixels(context.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE));
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document === "undefined") throw new Error("Canvas is unavailable.");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  mime: string,
  quality: number,
): Promise<Blob> {
  if ("convertToBlob" in canvas) {
    return canvas.convertToBlob({ quality, type: mime });
  }
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

import type { TrackKind } from "@/db/types";
import { classifyFile } from "@/lib/file-drop";
import {
  inferMediabunnyMime,
  isMediabunnySupportedContentType,
} from "@/lib/media-container-format";
import { probeMediaFileViaMediabunnyWorker } from "@/workers/media-probe-client";

export interface ProbedMedia {
  kind: TrackKind;
  durationSec: number;
  mime: string;
  probeSource?: "mediabunny-worker" | "native";
  title: string;
}

export class UnsupportedMediaError extends Error {
  readonly fileName: string;
  readonly mime: string;
  readonly kind: TrackKind;
  readonly mediaErrorCode?: number;

  constructor(file: File, kind: TrackKind, mime: string, mediaErrorCode?: number) {
    super(`Unsupported media format: ${file.name}`);
    this.name = "UnsupportedMediaError";
    this.fileName = file.name;
    this.mime = mime;
    this.kind = kind;
    this.mediaErrorCode = mediaErrorCode;
  }
}

export function isUnsupportedMediaError(err: unknown): err is UnsupportedMediaError {
  return err instanceof UnsupportedMediaError;
}

/** Give up reading metadata after this long (e.g. a codec the WebView can't decode). */
const PROBE_TIMEOUT_MS = 10_000;

/** Strip the extension and tidy a filename into a display title. */
function titleFromFilename(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[_-]+/g, " ")
      .trim() || "Untitled"
  );
}

/**
 * Probe an uploaded media file for its kind + duration by loading metadata into
 * a throwaway media element. Kind is decided MIME-first then by extension (so a
 * .mkv with an empty MIME is still "video", not "audio"). Browser-only; a
 * timeout falls back to 0 duration, but a definite media element error is
 * treated as unsupported for this WebView so it does not enter IndexedDB.
 */
export async function probeMediaFile(file: File): Promise<ProbedMedia> {
  const kind: TrackKind = classifyFile(file) === "video" ? "video" : "audio";
  const title = titleFromFilename(file.name);
  const mime =
    file.type || inferMediabunnyMime(file.name) || (kind === "video" ? "video/mp4" : "audio/mpeg");

  if (kind === "video" && isMediabunnySupportedContentType(mime, file.name)) {
    const fallback = await probeViaMediabunny(file);
    if (fallback) {
      return {
        durationSec: fallback.durationSec,
        kind,
        mime: fallback.mime || mime,
        probeSource: "mediabunny-worker",
        title,
      };
    }
  }

  return probeMediaFileViaNativeElement(file, kind, mime, title);
}

async function probeViaMediabunny(file: File) {
  try {
    return await probeMediaFileViaMediabunnyWorker(file);
  } catch {
    return null;
  }
}

function probeMediaFileViaNativeElement(
  file: File,
  kind: TrackKind,
  mime: string,
  title: string,
): Promise<ProbedMedia> {
  return new Promise<ProbedMedia>((resolve, reject) => {
    if (typeof document === "undefined") {
      resolve({ kind, durationSec: 0, mime, probeSource: "native", title });
      return;
    }
    // A <video> element reads metadata for both audio and video files.
    const el = document.createElement("video");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    };
    const done = (durationSec: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        kind,
        durationSec: Number.isFinite(durationSec) ? durationSec : 0,
        mime,
        probeSource: "native",
        title,
      });
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      const code = el.error?.code;
      cleanup();
      const nativeError = new UnsupportedMediaError(file, kind, mime, code);
      if (!isMediabunnySupportedContentType(mime, file.name)) {
        reject(nativeError);
        return;
      }
      void probeViaMediabunny(file)
        .then((fallback) => {
          if (!fallback) {
            reject(nativeError);
            return;
          }
          resolve({
            durationSec: fallback.durationSec,
            kind,
            mime: fallback.mime || mime,
            probeSource: "mediabunny-worker",
            title,
          });
        })
        .catch(() => reject(nativeError));
    };
    const timer = setTimeout(() => done(0), PROBE_TIMEOUT_MS);
    el.addEventListener("loadedmetadata", () => done(el.duration), { once: true });
    el.addEventListener("error", fail, { once: true });
    el.src = url;
  });
}

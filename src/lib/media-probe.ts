import type { TrackKind } from "@/db/types";

export interface ProbedMedia {
  kind: TrackKind;
  durationSec: number;
  mime: string;
  title: string;
}

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
 * a throwaway media element. Browser-only (uses DOM); the rest of the upload
 * path is pure and tested. Falls back to 0 duration if the browser can't read it.
 */
export function probeMediaFile(file: File): Promise<ProbedMedia> {
  const kind: TrackKind = file.type.startsWith("video/") ? "video" : "audio";
  const title = titleFromFilename(file.name);
  const mime = file.type || (kind === "video" ? "video/mp4" : "audio/mpeg");

  return new Promise<ProbedMedia>((resolve) => {
    if (typeof document === "undefined") {
      resolve({ kind, durationSec: 0, mime, title });
      return;
    }
    // A <video> element reads metadata for both audio and video files.
    const el = document.createElement("video");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    const done = (durationSec: number) => {
      URL.revokeObjectURL(url);
      resolve({ kind, durationSec: Number.isFinite(durationSec) ? durationSec : 0, mime, title });
    };
    el.addEventListener("loadedmetadata", () => done(el.duration), { once: true });
    el.addEventListener("error", () => done(0), { once: true });
    el.src = url;
  });
}
